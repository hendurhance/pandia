use std::collections::{HashMap, VecDeque};
use std::ops::Range;

use imara_diff::{Algorithm, Diff, InternedInput};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::jobs::CancelFlag;
use super::types::{DocError, DocResult, Path, PathSegment};

const CANCEL_CHECK_MASK: u32 = 0x0FFF;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum DiffKind {
    Added,
    Removed,
    Changed,
    Moved,
}

#[derive(Debug, Clone, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub path: Path,
    pub left_path: Option<Path>,
    pub kind: DiffKind,
    pub left_preview: Option<String>,
    pub right_preview: Option<String>,
}

pub fn compute_diff(left: &Value, right: &Value, cancel: &CancelFlag) -> DocResult<Vec<DiffEntry>> {
    let mut out = Vec::new();
    let mut stack = PathStack::default();
    let mut checked: u32 = 0;
    walk(left, right, &mut stack, &mut out, cancel, &mut checked)?;
    Ok(out)
}

#[derive(Default)]
struct PathStack {
    left: Vec<PathSegment>,
    right: Vec<PathSegment>,
}

impl PathStack {
    fn push_key(&mut self, key: &str) {
        self.left.push(PathSegment::Key(key.to_owned()));
        self.right.push(PathSegment::Key(key.to_owned()));
    }

    fn push_index(&mut self, left: usize, right: usize) {
        self.left.push(PathSegment::Index(left as u32));
        self.right.push(PathSegment::Index(right as u32));
    }

    fn pop(&mut self) {
        self.left.pop();
        self.right.pop();
    }

    fn entry(&self, kind: DiffKind, left: Option<&Value>, right: Option<&Value>) -> DiffEntry {
        DiffEntry {
            path: Path(self.right.clone()),
            left_path: (self.left != self.right).then(|| Path(self.left.clone())),
            kind,
            left_preview: left.map(preview),
            right_preview: right.map(preview),
        }
    }
}

fn walk(
    left: &Value,
    right: &Value,
    stack: &mut PathStack,
    out: &mut Vec<DiffEntry>,
    cancel: &CancelFlag,
    checked: &mut u32,
) -> DocResult<()> {
    *checked = checked.wrapping_add(1);
    if *checked & CANCEL_CHECK_MASK == 0 && cancel.is_cancelled() {
        return Err(DocError::Cancelled);
    }
    if left == right {
        return Ok(());
    }

    match (left, right) {
        (Value::Object(l), Value::Object(r)) => {
            for (k, lv) in l.iter() {
                stack.push_key(k);
                let res = match r.get(k) {
                    Some(rv) => walk(lv, rv, stack, out, cancel, checked),
                    None => {
                        out.push(stack.entry(DiffKind::Removed, Some(lv), None));
                        Ok(())
                    }
                };
                stack.pop();
                res?;
            }
            for (k, rv) in r.iter() {
                if !l.contains_key(k) {
                    stack.push_key(k);
                    out.push(stack.entry(DiffKind::Added, None, Some(rv)));
                    stack.pop();
                }
            }
        }
        (Value::Array(l), Value::Array(r)) => diff_arrays(l, r, stack, out, cancel, checked)?,
        _ => out.push(stack.entry(DiffKind::Changed, Some(left), Some(right))),
    }
    Ok(())
}

enum ArrOp<'a> {
    Remove(usize, &'a Value), // left index
    Add(usize, &'a Value),    // right index
}

fn diff_arrays(
    l: &[Value],
    r: &[Value],
    stack: &mut PathStack,
    out: &mut Vec<DiffEntry>,
    cancel: &CancelFlag,
    checked: &mut u32,
) -> DocResult<()> {
    let mut pre = 0;
    while pre < l.len() && pre < r.len() && l[pre] == r[pre] {
        pre += 1;
    }
    let (mut sl, mut sr) = (l.len(), r.len());
    while sl > pre && sr > pre && l[sl - 1] == r[sr - 1] {
        sl -= 1;
        sr -= 1;
    }
    let ops = align_middle(&l[pre..sl], &r[pre..sr], pre);

    let n = ops.len();
    #[derive(Clone, Copy)]
    enum Pair {
        None,
        ChangedAt(usize), // partner index in ops
        MovedTo(usize),   // partner index in ops
    }
    let mut pair = vec![Pair::None; n];

    let mut adds_by_value: HashMap<String, Vec<usize>> = HashMap::new();
    for (j, op) in ops.iter().enumerate() {
        if j as u32 & CANCEL_CHECK_MASK == 0 && cancel.is_cancelled() {
            return Err(DocError::Cancelled);
        }
        if let ArrOp::Add(_, rv) = op {
            adds_by_value
                .entry(serde_json::to_string(rv).unwrap_or_default())
                .or_default()
                .push(j);
        }
    }
    for i in 0..n {
        if i as u32 & CANCEL_CHECK_MASK == 0 && cancel.is_cancelled() {
            return Err(DocError::Cancelled);
        }
        if let ArrOp::Remove(_, lv) = &ops[i] {
            let key = serde_json::to_string(lv).unwrap_or_default();
            if let Some(candidates) = adds_by_value.get_mut(&key) {
                while let Some(j) = candidates.pop() {
                    if matches!(pair[j], Pair::None) {
                        pair[i] = Pair::MovedTo(j);
                        pair[j] = Pair::MovedTo(i);
                        break;
                    }
                }
            }
        }
    }

    let mut pair_in_order = |gap: Range<usize>, class: fn(&Value) -> usize| {
        let mut waiting: [[VecDeque<usize>; 3]; 2] = Default::default();
        for k in gap {
            if !matches!(pair[k], Pair::None) {
                continue;
            }
            let (side, v) = match ops[k] {
                ArrOp::Remove(_, v) => (0, v),
                ArrOp::Add(_, v) => (1, v),
            };
            match waiting[1 - side][class(v)].pop_front() {
                Some(j) => {
                    pair[k] = Pair::ChangedAt(j);
                    pair[j] = Pair::ChangedAt(k);
                }
                None => waiting[side][class(v)].push_back(k),
            }
        }
    };

    let (mut removes, mut adds) = (0, 0);
    let aligned: Vec<usize> = ops
        .iter()
        .map(|op| match op {
            ArrOp::Remove(x, _) => {
                removes += 1;
                x + 1 - removes
            }
            ArrOp::Add(y, _) => {
                adds += 1;
                y + 1 - adds
            }
        })
        .collect();
    let mut start = 0;
    for run in aligned.chunk_by(|a, b| a == b) {
        let gap = start..start + run.len();
        start = gap.end;
        pair_in_order(gap.clone(), shape);
        let removed = ops[gap.clone()]
            .iter()
            .filter(|op| matches!(op, ArrOp::Remove(..)))
            .count();
        if 2 * removed == gap.len() {
            pair_in_order(gap, |_| 0);
        }
    }

    let mut emitted = vec![false; n];
    for k in 0..n {
        if emitted[k] {
            continue;
        }
        emitted[k] = true;
        match pair[k] {
            Pair::ChangedAt(_) if matches!(ops[k], ArrOp::Remove(..)) => {}
            Pair::ChangedAt(j) => {
                let (ArrOp::Add(y, rv), ArrOp::Remove(x, lv)) = (&ops[k], &ops[j]) else {
                    unreachable!("ChangedAt pairs a Remove with an Add");
                };
                stack.push_index(*x, *y);
                let res = walk(lv, rv, stack, out, cancel, checked);
                stack.pop();
                res?;
            }
            Pair::MovedTo(j) => {
                emitted[j] = true;
                let (from_idx, to_idx, val) = match (&ops[k], &ops[j]) {
                    (ArrOp::Remove(x, lv), ArrOp::Add(y, _)) => (*x, *y, *lv),
                    (ArrOp::Add(y, _), ArrOp::Remove(x, lv)) => (*x, *y, *lv),
                    _ => unreachable!("MovedTo pairs a Remove with an Add"),
                };
                stack.push_index(from_idx, to_idx);
                out.push(stack.entry(DiffKind::Moved, Some(val), Some(val)));
                stack.pop();
            }
            Pair::None => match &ops[k] {
                ArrOp::Remove(x, lv) => {
                    stack.push_index(*x, *x);
                    out.push(stack.entry(DiffKind::Removed, Some(lv), None));
                    stack.pop();
                }
                ArrOp::Add(y, rv) => {
                    stack.push_index(*y, *y);
                    out.push(stack.entry(DiffKind::Added, None, Some(rv)));
                    stack.pop();
                }
            },
        }
    }
    Ok(())
}

fn shape(v: &Value) -> usize {
    match v {
        Value::Object(_) => 0,
        Value::Array(_) => 1,
        _ => 2,
    }
}

#[allow(clippy::needless_range_loop)]
fn align_middle<'a>(a: &'a [Value], b: &'a [Value], base: usize) -> Vec<ArrOp<'a>> {
    let (n, m) = (a.len(), b.len());
    let mut ops = Vec::new();
    if n == 0 {
        for j in 0..m {
            ops.push(ArrOp::Add(base + j, &b[j]));
        }
        return ops;
    }
    if m == 0 {
        for i in 0..n {
            ops.push(ArrOp::Remove(base + i, &a[i]));
        }
        return ops;
    }

    const CELL_CAP: usize = 100_000;
    if n.saturating_mul(m) > CELL_CAP {
        let mut input = InternedInput::default();
        input.update_before(a.iter());
        input.update_after(b.iter());
        for hunk in Diff::compute(Algorithm::Histogram, &input).hunks() {
            for i in hunk.before {
                ops.push(ArrOp::Remove(base + i as usize, &a[i as usize]));
            }
            for j in hunk.after {
                ops.push(ArrOp::Add(base + j as usize, &b[j as usize]));
            }
        }
        return ops;
    }

    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] {
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            ops.push(ArrOp::Remove(base + i, &a[i]));
            i += 1;
        } else {
            ops.push(ArrOp::Add(base + j, &b[j]));
            j += 1;
        }
    }
    while i < n {
        ops.push(ArrOp::Remove(base + i, &a[i]));
        i += 1;
    }
    while j < m {
        ops.push(ArrOp::Add(base + j, &b[j]));
        j += 1;
    }
    ops
}

fn preview(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => {
            const MAX: usize = 80;
            if s.chars().count() > MAX {
                let truncated: String = s.chars().take(MAX).collect();
                format!("\"{truncated}\u{2026}\"")
            } else {
                format!("\"{s}\"")
            }
        }
        Value::Array(a) if a.is_empty() => "[]".into(),
        Value::Array(a) => format!("[{} items]", a.len()),
        Value::Object(m) if m.is_empty() => "{}".into(),
        Value::Object(m) => format!("{{{} keys}}", m.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn diff(l: Value, r: Value) -> Vec<DiffEntry> {
        compute_diff(&l, &r, &CancelFlag::never()).expect("never cancelled")
    }

    fn segs(parts: &[&str]) -> Path {
        Path(
            parts
                .iter()
                .map(|p| {
                    if let Ok(i) = p.parse::<u32>() {
                        PathSegment::Index(i)
                    } else {
                        PathSegment::Key((*p).to_string())
                    }
                })
                .collect(),
        )
    }

    #[test]
    fn equal_values_produce_no_entries() {
        let entries = diff(json!({"a": 1, "b": [1, 2]}), json!({"a": 1, "b": [1, 2]}));
        assert!(entries.is_empty());
    }

    #[test]
    fn changed_primitive_emits_single_changed() {
        let entries = diff(json!({"a": 1}), json!({"a": 2}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, segs(&["a"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[0].left_preview.as_deref(), Some("1"));
        assert_eq!(entries[0].right_preview.as_deref(), Some("2"));
    }

    #[test]
    fn type_change_emits_changed_at_boundary_no_recursion() {
        let entries = diff(json!({"a": {"b": 1, "c": 2}}), json!({"a": 5}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, segs(&["a"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
    }

    #[test]
    fn added_key_in_right_emits_added() {
        let entries = diff(json!({"a": 1}), json!({"a": 1, "b": 2}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Added);
        assert_eq!(entries[0].path, segs(&["b"]));
        assert_eq!(entries[0].left_preview, None);
        assert_eq!(entries[0].right_preview.as_deref(), Some("2"));
    }

    #[test]
    fn removed_key_in_right_emits_removed() {
        let entries = diff(json!({"a": 1, "b": 2}), json!({"a": 1}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Removed);
        assert_eq!(entries[0].path, segs(&["b"]));
    }

    #[test]
    fn nested_changes_recurse_into_objects() {
        let l = json!({"user": {"name": "Ada", "age": 30}});
        let r = json!({"user": {"name": "Ada", "age": 31}});
        let entries = diff(l, r);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, segs(&["user", "age"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
    }

    #[test]
    fn array_index_changes_emit_per_index() {
        let entries = diff(json!([1, 2, 3]), json!([1, 5, 3]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
    }

    #[test]
    fn array_length_change_emits_added_for_extra_right() {
        let entries = diff(json!([1, 2]), json!([1, 2, 3, 4]));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].kind, DiffKind::Added);
        assert_eq!(entries[0].path, segs(&["2"]));
        assert_eq!(entries[1].kind, DiffKind::Added);
        assert_eq!(entries[1].path, segs(&["3"]));
    }

    #[test]
    fn array_length_change_emits_removed_for_extra_left() {
        let entries = diff(json!([1, 2, 3, 4]), json!([1, 2]));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].kind, DiffKind::Removed);
        assert_eq!(entries[0].path, segs(&["2"]));
        assert_eq!(entries[1].kind, DiffKind::Removed);
        assert_eq!(entries[1].path, segs(&["3"]));
    }

    #[test]
    fn array_middle_insertion_does_not_cascade() {
        let entries = diff(
            json!(["a", "b", "c", "d"]),
            json!(["a", "x", "b", "c", "d"]),
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Added);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].right_preview.as_deref(), Some("\"x\""));
    }

    #[test]
    fn array_middle_deletion_does_not_cascade() {
        let entries = diff(json!(["a", "b", "c", "d"]), json!(["a", "c", "d"]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Removed);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].left_preview.as_deref(), Some("\"b\""));
    }

    #[test]
    fn array_element_field_change_recurses_via_merge() {
        let l = json!([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]);
        let r = json!([{"id": 1, "name": "a"}, {"id": 2, "name": "B"}]);
        let entries = diff(l, r);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, segs(&["1", "name"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
    }

    #[test]
    fn array_insert_plus_change_separates_cleanly() {
        let entries = diff(json!(["a", "b", "c"]), json!(["a", "B", "X", "c"]));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[1].path, segs(&["2"]));
        assert_eq!(entries[1].kind, DiffKind::Added);
    }

    #[test]
    fn an_edit_after_an_insert_diffs_inside_the_shifted_item() {
        let l = json!([{"id": 1, "v": "a"}, {"id": 2, "v": "b"}, {"id": 3, "v": "c"}]);
        let r = json!([
            {"id": 1, "v": "a"},
            {"id": 9, "v": "x"},
            {"id": 2, "v": "b"},
            {"id": 3, "v": "CHANGED"}
        ]);
        let entries = diff(l, r);
        let got: Vec<_> = entries
            .iter()
            .map(|e| (e.kind, e.path.clone(), e.left_path.clone()))
            .collect();
        assert_eq!(
            got,
            vec![
                (DiffKind::Added, segs(&["1"]), None),
                (
                    DiffKind::Changed,
                    segs(&["3", "v"]),
                    Some(segs(&["2", "v"]))
                ),
            ]
        );
        assert_eq!(entries[1].left_preview.as_deref(), Some("\"c\""));
        assert_eq!(entries[1].right_preview.as_deref(), Some("\"CHANGED\""));
    }

    #[test]
    fn unmatched_items_pair_only_with_the_same_shape() {
        let entries = diff(json!([0, {"v": "a"}, 9]), json!([0, "new", {"v": "b"}, 9]));
        let got: Vec<_> = entries
            .into_iter()
            .map(|e| (e.kind, e.path, e.left_path))
            .collect();
        assert_eq!(
            got,
            vec![
                (DiffKind::Added, segs(&["1"]), None),
                (
                    DiffKind::Changed,
                    segs(&["2", "v"]),
                    Some(segs(&["1", "v"]))
                ),
            ]
        );
    }

    #[test]
    fn an_in_place_type_swap_shows_as_changed() {
        let entries = diff(json!([1, 2, 3]), json!([1, {"a": 1}, 3]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].left_preview.as_deref(), Some("2"));
        assert_eq!(entries[0].right_preview.as_deref(), Some("{1 keys}"));
    }

    #[test]
    fn a_type_swap_beside_an_insert_stays_removed_and_added() {
        let entries = diff(json!([0, {"v": "a"}, 9]), json!([0, "x", "y", 9]));
        let got: Vec<_> = entries.into_iter().map(|e| (e.kind, e.path)).collect();
        assert_eq!(
            got,
            vec![
                (DiffKind::Removed, segs(&["1"])),
                (DiffKind::Added, segs(&["1"])),
                (DiffKind::Added, segs(&["2"])),
            ]
        );
    }

    #[test]
    fn object_key_order_independent_for_equality() {
        let entries = diff(json!({"a": 1, "b": 2}), json!({"b": 2, "a": 1}));
        assert!(entries.is_empty());
    }

    #[test]
    fn emission_walks_left_keys_first_then_added_in_right_order() {
        let l = json!({"a": 1, "b": 2});
        let r = json!({"a": 99, "c": 3, "d": 4});
        let entries = diff(l, r);
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].path, segs(&["a"]));
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[1].path, segs(&["b"]));
        assert_eq!(entries[1].kind, DiffKind::Removed);
        assert_eq!(entries[2].path, segs(&["c"]));
        assert_eq!(entries[2].kind, DiffKind::Added);
        assert_eq!(entries[3].path, segs(&["d"]));
        assert_eq!(entries[3].kind, DiffKind::Added);
    }

    #[test]
    fn root_replacement_emits_single_changed_at_root() {
        let entries = diff(json!([1, 2, 3]), json!({"a": 1}));
        assert_eq!(entries.len(), 1);
        assert!(entries[0].path.0.is_empty());
        assert_eq!(entries[0].kind, DiffKind::Changed);
    }

    #[test]
    fn preview_truncates_long_strings() {
        let long_l: String = std::iter::repeat('x').take(200).collect();
        let entries = diff(json!({"k": long_l}), json!({"k": "short"}));
        assert_eq!(entries.len(), 1);
        let lp = entries[0].left_preview.as_deref().unwrap();
        assert!(lp.ends_with("\u{2026}\""));
        assert!(lp.chars().count() <= 83);
    }

    #[test]
    fn moved_element_emits_single_moved_entry() {
        let entries = diff(json!(["a", "b", "c"]), json!(["b", "c", "a"]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Moved);
        assert_eq!(entries[0].path, segs(&["2"]));
        assert_eq!(entries[0].left_path, Some(segs(&["0"])));
        assert_eq!(entries[0].left_preview.as_deref(), Some("\"a\""));
        assert_eq!(entries[0].right_preview.as_deref(), Some("\"a\""));
    }

    #[test]
    fn in_place_change_stays_changed_not_moved() {
        let entries = diff(json!(["a", "b", "c"]), json!(["a", "X", "c"]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].left_path, None);
    }

    #[test]
    fn move_plus_add_emits_one_moved_and_one_added() {
        let entries = diff(json!(["a", "b", "c"]), json!(["b", "c", "a", "d"]));
        assert_eq!(entries.len(), 2);
        let moved = entries.iter().find(|e| e.kind == DiffKind::Moved).unwrap();
        let added = entries.iter().find(|e| e.kind == DiffKind::Added).unwrap();
        assert_eq!(moved.path, segs(&["2"]));
        assert_eq!(moved.left_path, Some(segs(&["0"])));
        assert_eq!(added.path, segs(&["3"]));
        assert_eq!(added.left_path, None);
    }

    #[test]
    fn shifted_rows_still_align_past_the_cell_cap() {
        let insert_and_edit = |n: usize| {
            let left: Vec<Value> = (0..n)
                .map(|i| json!({"id": i, "name": format!("row {i}"), "ok": true}))
                .collect();
            let mut right = left.clone();
            right.insert(5, json!({"id": "new"}));
            right[n - 4]["name"] = json!("edited");
            diff(Value::Array(left), Value::Array(right))
                .into_iter()
                .map(|e| (e.kind, e.path, e.left_path))
                .collect::<Vec<_>>()
        };
        let exact = insert_and_edit(300);
        let capped = insert_and_edit(1000);
        assert_eq!(capped.len(), exact.len());
        assert_eq!(
            capped,
            vec![
                (DiffKind::Added, segs(&["5"]), None),
                (
                    DiffKind::Changed,
                    segs(&["996", "name"]),
                    Some(segs(&["995", "name"]))
                ),
            ]
        );
    }

    #[test]
    fn preview_collections_show_counts() {
        let entries = diff(json!({"a": [1, 2, 3]}), json!({"a": "scalar"}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].left_preview.as_deref(), Some("[3 items]"));
        assert_eq!(entries[0].right_preview.as_deref(), Some("\"scalar\""));
    }
}
