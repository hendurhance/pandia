
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{Path, PathSegment};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffKind {
    Added,
    Removed,
    Changed,
    Moved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub path: Path,
    pub kind: DiffKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub from_index: Option<u32>,
}

pub fn compute_diff(left: &Value, right: &Value) -> Vec<DiffEntry> {
    let mut out = Vec::new();
    let mut stack: Vec<PathSegment> = Vec::new();
    walk(left, right, &mut stack, &mut out);
    out
}

fn walk(left: &Value, right: &Value, stack: &mut Vec<PathSegment>, out: &mut Vec<DiffEntry>) {
    if left == right {
        return;
    }

    match (left, right) {
        (Value::Object(l), Value::Object(r)) => {
            for (k, lv) in l.iter() {
                stack.push(PathSegment::Key(k.clone()));
                match r.get(k) {
                    Some(rv) => walk(lv, rv, stack, out),
                    None => out.push(DiffEntry {
                        path: Path(stack.clone()),
                        kind: DiffKind::Removed,
                        left_preview: Some(preview(lv)),
                        right_preview: None,
                        from_index: None,
                    }),
                }
                stack.pop();
            }
            for (k, rv) in r.iter() {
                if !l.contains_key(k) {
                    stack.push(PathSegment::Key(k.clone()));
                    out.push(DiffEntry {
                        path: Path(stack.clone()),
                        kind: DiffKind::Added,
                        left_preview: None,
                        right_preview: Some(preview(rv)),
                        from_index: None,
                    });
                    stack.pop();
                }
            }
        }
        (Value::Array(l), Value::Array(r)) => diff_arrays(l, r, stack, out),
        _ => out.push(DiffEntry {
            path: Path(stack.clone()),
            kind: DiffKind::Changed,
            left_preview: Some(preview(left)),
            right_preview: Some(preview(right)),
            from_index: None,
        }),
    }
}

enum ArrOp<'a> {
    Remove(usize, &'a Value), // left index
    Add(usize, &'a Value),    // right index
}

fn diff_arrays(l: &[Value], r: &[Value], stack: &mut Vec<PathSegment>, out: &mut Vec<DiffEntry>) {
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

    let mut k = 0;
    while k + 1 < n {
        if let (ArrOp::Remove(x, _), ArrOp::Add(y, _)) = (&ops[k], &ops[k + 1]) {
            if x == y {
                pair[k] = Pair::ChangedAt(k + 1);
                pair[k + 1] = Pair::ChangedAt(k);
                k += 2;
                continue;
            }
        }
        k += 1;
    }

    for i in 0..n {
        if !matches!(pair[i], Pair::None) {
            continue;
        }
        if let ArrOp::Remove(_, lv) = &ops[i] {
            for j in (i + 1)..n {
                if !matches!(pair[j], Pair::None) {
                    continue;
                }
                if let ArrOp::Add(_, rv) = &ops[j] {
                    if *lv == *rv {
                        pair[i] = Pair::MovedTo(j);
                        pair[j] = Pair::MovedTo(i);
                        break;
                    }
                }
            }
        }
    }

    let mut emitted = vec![false; n];
    for k in 0..n {
        if emitted[k] {
            continue;
        }
        emitted[k] = true;
        match pair[k] {
            Pair::ChangedAt(j) => {
                emitted[j] = true;
                let (idx, lv, rv) = match (&ops[k], &ops[j]) {
                    (ArrOp::Remove(x, lv), ArrOp::Add(_, rv))
                    | (ArrOp::Add(_, rv), ArrOp::Remove(x, lv)) => (*x, *lv, *rv),
                    _ => unreachable!("ChangedAt pairs a Remove with an Add"),
                };
                stack.push(PathSegment::Index(idx as u32));
                walk(lv, rv, stack, out);
                stack.pop();
            }
            Pair::MovedTo(j) => {
                emitted[j] = true;
                let (from_idx, to_idx, val) = match (&ops[k], &ops[j]) {
                    (ArrOp::Remove(x, lv), ArrOp::Add(y, _)) => (*x, *y, *lv),
                    (ArrOp::Add(y, _), ArrOp::Remove(x, lv)) => (*x, *y, *lv),
                    _ => unreachable!("MovedTo pairs a Remove with an Add"),
                };
                stack.push(PathSegment::Index(to_idx as u32));
                out.push(DiffEntry {
                    path: Path(stack.clone()),
                    kind: DiffKind::Moved,
                    left_preview: Some(preview(val)),
                    right_preview: Some(preview(val)),
                    from_index: Some(from_idx as u32),
                });
                stack.pop();
            }
            Pair::None => match &ops[k] {
                ArrOp::Remove(x, lv) => {
                    stack.push(PathSegment::Index(*x as u32));
                    out.push(DiffEntry {
                        path: Path(stack.clone()),
                        kind: DiffKind::Removed,
                        left_preview: Some(preview(lv)),
                        right_preview: None,
                        from_index: None,
                    });
                    stack.pop();
                }
                ArrOp::Add(y, rv) => {
                    stack.push(PathSegment::Index(*y as u32));
                    out.push(DiffEntry {
                        path: Path(stack.clone()),
                        kind: DiffKind::Added,
                        left_preview: None,
                        right_preview: Some(preview(rv)),
                        from_index: None,
                    });
                    stack.pop();
                }
            },
        }
    }
}

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
        let common = n.min(m);
        for i in 0..common {
            ops.push(ArrOp::Remove(base + i, &a[i]));
            ops.push(ArrOp::Add(base + i, &b[i]));
        }
        for i in common..n {
            ops.push(ArrOp::Remove(base + i, &a[i]));
        }
        for j in common..m {
            ops.push(ArrOp::Add(base + j, &b[j]));
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
                format!("\"{}\u{2026}\"", truncated)
            } else {
                format!("\"{}\"", s)
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
        compute_diff(&l, &r)
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
        assert_eq!(entries[0].from_index, Some(0));
        assert_eq!(entries[0].left_preview.as_deref(), Some("\"a\""));
        assert_eq!(entries[0].right_preview.as_deref(), Some("\"a\""));
    }

    #[test]
    fn in_place_change_stays_changed_not_moved() {
        let entries = diff(json!(["a", "b", "c"]), json!(["a", "X", "c"]));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, DiffKind::Changed);
        assert_eq!(entries[0].path, segs(&["1"]));
        assert_eq!(entries[0].from_index, None);
    }

    #[test]
    fn move_plus_add_emits_one_moved_and_one_added() {
        let entries = diff(json!(["a", "b", "c"]), json!(["b", "c", "a", "d"]));
        assert_eq!(entries.len(), 2);
        let moved = entries.iter().find(|e| e.kind == DiffKind::Moved).unwrap();
        let added = entries.iter().find(|e| e.kind == DiffKind::Added).unwrap();
        assert_eq!(moved.path, segs(&["2"]));
        assert_eq!(moved.from_index, Some(0));
        assert_eq!(added.path, segs(&["3"]));
        assert_eq!(added.from_index, None);
    }

    #[test]
    fn preview_collections_show_counts() {
        let entries = diff(json!({"a": [1, 2, 3]}), json!({"a": "scalar"}));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].left_preview.as_deref(), Some("[3 items]"));
        assert_eq!(entries[0].right_preview.as_deref(), Some("\"scalar\""));
    }
}
