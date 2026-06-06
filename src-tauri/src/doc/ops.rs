use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::types::{DocError, DocResult, Path, PathSegment};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Op {
    SetValue {
        path: Path,
        value: Value,
    },

    RenameKey {
        path: Path,
        from: String,
        to: String,
    },

    InsertKey {
        path: Path,
        key: String,
        value: Value,
        position: Option<usize>,
    },

    DeleteKey {
        path: Path,
        key: String,
    },

    InsertItem {
        path: Path,
        index: usize,
        value: Value,
    },

    DeleteItem {
        path: Path,
        index: usize,
    },

    MoveItem {
        path: Path,
        from: usize,
        to: usize,
    },

    ReorderKeys {
        path: Path,
        order: Vec<String>,
    },

    SortKeys {
        path: Path,
        descending: bool,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpOutcome {
    pub inverse: Op,
    pub affected_paths: Vec<Path>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpDescription {
    pub label: String,
    pub path_display: String,
}

impl Op {
    pub fn describe(&self) -> OpDescription {
        let (label, path) = match self {
            Op::SetValue { path, .. } => ("set value".to_string(), path.clone()),
            Op::RenameKey { path, from, to } => {
                let mut p = path.clone();
                p.push(PathSegment::Key(from.clone()));
                (format!("rename key → {}", to), p)
            }
            Op::InsertKey { path, key, .. } => {
                let mut p = path.clone();
                p.push(PathSegment::Key(key.clone()));
                ("insert key".to_string(), p)
            }
            Op::DeleteKey { path, key } => {
                let mut p = path.clone();
                p.push(PathSegment::Key(key.clone()));
                ("delete key".to_string(), p)
            }
            Op::InsertItem { path, index, .. } => {
                let mut p = path.clone();
                p.push(PathSegment::Index(*index as u32));
                ("insert item".to_string(), p)
            }
            Op::DeleteItem { path, index } => {
                let mut p = path.clone();
                p.push(PathSegment::Index(*index as u32));
                ("delete item".to_string(), p)
            }
            Op::MoveItem { path, from, to } => {
                let mut p = path.clone();
                p.push(PathSegment::Index(*from as u32));
                (format!("move item → [{to}]"), p)
            }
            Op::ReorderKeys { path, .. } => ("reorder keys".to_string(), path.clone()),
            Op::SortKeys { path, .. } => ("sort keys".to_string(), path.clone()),
        };
        OpDescription {
            label,
            path_display: path.to_string(),
        }
    }

    pub fn apply(&self, root: &mut Value) -> DocResult<OpOutcome> {
        match self {
            Op::SetValue { path, value } => apply_set_value(root, path, value.clone()),
            Op::RenameKey { path, from, to } => apply_rename_key(root, path, from, to),
            Op::InsertKey {
                path,
                key,
                value,
                position,
            } => apply_insert_key(root, path, key, value.clone(), *position),
            Op::DeleteKey { path, key } => apply_delete_key(root, path, key),
            Op::InsertItem { path, index, value } => {
                apply_insert_item(root, path, *index, value.clone())
            }
            Op::DeleteItem { path, index } => apply_delete_item(root, path, *index),
            Op::MoveItem { path, from, to } => apply_move_item(root, path, *from, *to),
            Op::ReorderKeys { path, order } => apply_reorder_keys(root, path, order),
            Op::SortKeys { path, descending } => apply_sort_keys(root, path, *descending),
        }
    }
}

fn navigate_mut<'a>(root: &'a mut Value, path: &Path) -> DocResult<&'a mut Value> {
    let mut cur = root;
    for seg in &path.0 {
        cur = match (cur, seg) {
            (Value::Object(map), PathSegment::Key(k)) => map
                .get_mut(k)
                .ok_or_else(|| DocError::InvalidPath(path.clone()))?,
            (Value::Array(arr), PathSegment::Index(i)) => arr
                .get_mut(*i as usize)
                .ok_or_else(|| DocError::InvalidPath(path.clone()))?,
            _ => return Err(DocError::InvalidPath(path.clone())),
        };
    }
    Ok(cur)
}

fn apply_set_value(root: &mut Value, path: &Path, new_value: Value) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let old = std::mem::replace(target, new_value);
    Ok(OpOutcome {
        inverse: Op::SetValue {
            path: path.clone(),
            value: old,
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_rename_key(root: &mut Value, path: &Path, from: &str, to: &str) -> DocResult<OpOutcome> {
    if from == to {
        return Err(DocError::Edit("rename target equals source".to_string()));
    }
    let target = navigate_mut(root, path)?;
    let map = match target {
        Value::Object(m) => m,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    if !map.contains_key(from) {
        return Err(DocError::Edit(format!("key {from:?} not found")));
    }
    if map.contains_key(to) {
        return Err(DocError::Edit(format!("key {to:?} already exists")));
    }
    let pos = map
        .keys()
        .position(|k| k == from)
        .expect("checked above with contains_key");
    let value = map.shift_remove(from).expect("checked above");
    map.shift_insert(pos, to.to_string(), value);

    Ok(OpOutcome {
        inverse: Op::RenameKey {
            path: path.clone(),
            from: to.to_string(),
            to: from.to_string(),
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_insert_key(
    root: &mut Value,
    path: &Path,
    key: &str,
    value: Value,
    position: Option<usize>,
) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let map = match target {
        Value::Object(m) => m,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    if map.contains_key(key) {
        return Err(DocError::Edit(format!("key {key:?} already exists")));
    }
    match position {
        Some(p) if p > map.len() => {
            return Err(DocError::Edit(format!(
                "position {p} out of bounds (object has {} keys)",
                map.len()
            )));
        }
        Some(p) => {
            map.shift_insert(p, key.to_string(), value);
        }
        None => {
            map.insert(key.to_string(), value);
        }
    }
    Ok(OpOutcome {
        inverse: Op::DeleteKey {
            path: path.clone(),
            key: key.to_string(),
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_delete_key(root: &mut Value, path: &Path, key: &str) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let map = match target {
        Value::Object(m) => m,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    let pos = map
        .keys()
        .position(|k| k == key)
        .ok_or_else(|| DocError::Edit(format!("key {key:?} not found")))?;
    let value = map.shift_remove(key).expect("checked above");
    Ok(OpOutcome {
        inverse: Op::InsertKey {
            path: path.clone(),
            key: key.to_string(),
            value,
            position: Some(pos),
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_insert_item(
    root: &mut Value,
    path: &Path,
    index: usize,
    value: Value,
) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let arr = match target {
        Value::Array(a) => a,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    if index > arr.len() {
        return Err(DocError::Edit(format!(
            "index {index} out of bounds (array has {} items)",
            arr.len()
        )));
    }
    arr.insert(index, value);
    Ok(OpOutcome {
        inverse: Op::DeleteItem {
            path: path.clone(),
            index,
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_delete_item(root: &mut Value, path: &Path, index: usize) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let arr = match target {
        Value::Array(a) => a,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    if index >= arr.len() {
        return Err(DocError::Edit(format!(
            "index {index} out of bounds (array has {} items)",
            arr.len()
        )));
    }
    let value = arr.remove(index);
    Ok(OpOutcome {
        inverse: Op::InsertItem {
            path: path.clone(),
            index,
            value,
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_move_item(root: &mut Value, path: &Path, from: usize, to: usize) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let arr = match target {
        Value::Array(a) => a,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    let len = arr.len();
    if from >= len || to >= len {
        return Err(DocError::Edit(format!(
            "move index out of bounds (from {from}, to {to}, array has {len} items)"
        )));
    }
    if from == to {
        return Err(DocError::Edit("move source equals destination".to_string()));
    }
    let item = arr.remove(from);
    arr.insert(to, item);
    Ok(OpOutcome {
        inverse: Op::MoveItem {
            path: path.clone(),
            from: to,
            to: from,
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_reorder_keys(root: &mut Value, path: &Path, order: &[String]) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    let map = match target {
        Value::Object(m) => m,
        _ => return Err(DocError::InvalidPath(path.clone())),
    };
    let old_order: Vec<String> = map.keys().cloned().collect();
    if order.len() != old_order.len() {
        return Err(DocError::Edit(format!(
            "reorder list has {} keys but object has {}",
            order.len(),
            old_order.len()
        )));
    }
    let mut seen: std::collections::HashSet<&String> = std::collections::HashSet::new();
    for k in order {
        if !map.contains_key(k) {
            return Err(DocError::Edit(format!("key {k:?} not in object")));
        }
        if !seen.insert(k) {
            return Err(DocError::Edit(format!(
                "duplicate key {k:?} in reorder list"
            )));
        }
    }
    let mut old = std::mem::replace(map, Map::new());
    for k in order {
        let v = old.shift_remove(k).expect("validated above");
        map.insert(k.clone(), v);
    }
    Ok(OpOutcome {
        inverse: Op::ReorderKeys {
            path: path.clone(),
            order: old_order,
        },
        affected_paths: vec![path.clone()],
    })
}

fn apply_sort_keys(root: &mut Value, path: &Path, descending: bool) -> DocResult<OpOutcome> {
    let target = navigate_mut(root, path)?;
    if !target.is_object() {
        return Err(DocError::InvalidPath(path.clone()));
    }
    let original = target.clone();
    sort_keys_in_place(target, descending);
    Ok(OpOutcome {
        inverse: Op::SetValue {
            path: path.clone(),
            value: original,
        },
        affected_paths: vec![path.clone()],
    })
}

fn sort_keys_in_place(value: &mut Value, descending: bool) {
    match value {
        Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                sort_keys_in_place(v, descending);
            }
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort_unstable();
            if descending {
                keys.reverse();
            }
            let mut old = std::mem::replace(map, Map::new());
            for k in keys {
                let v = old.shift_remove(&k).expect("key collected from this map");
                map.insert(k, v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                sort_keys_in_place(v, descending);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn root() -> Path {
        Path::root()
    }
    fn p(segs: Vec<PathSegment>) -> Path {
        Path(segs)
    }
    fn k(s: &str) -> PathSegment {
        PathSegment::Key(s.into())
    }
    fn i(n: u32) -> PathSegment {
        PathSegment::Index(n)
    }

    #[test]
    fn describe_includes_target_key_and_index() {
        let d = Op::SetValue {
            path: p(vec![k("a"), k("b")]),
            value: json!(1),
        }
        .describe();
        assert_eq!(d.label, "set value");
        assert_eq!(d.path_display, "$.a.b");

        let d = Op::DeleteKey {
            path: p(vec![k("user")]),
            key: "name".into(),
        }
        .describe();
        assert_eq!(d.label, "delete key");
        assert_eq!(d.path_display, "$.user.name");

        let d = Op::InsertItem {
            path: p(vec![k("items")]),
            index: 3,
            value: json!(null),
        }
        .describe();
        assert_eq!(d.label, "insert item");
        assert_eq!(d.path_display, "$.items[3]");

        let d = Op::RenameKey {
            path: root(),
            from: "old".into(),
            to: "new".into(),
        }
        .describe();
        assert_eq!(d.label, "rename key → new");
        assert_eq!(d.path_display, "$.old");
    }

    fn round_trip(initial: Value, op: Op) -> Value {
        let mut state = initial.clone();
        let outcome = op.apply(&mut state).expect("forward apply");
        outcome.inverse.apply(&mut state).expect("inverse apply");
        assert_eq!(
            state, initial,
            "round-trip should return to the initial state"
        );
        state
    }

    #[test]
    fn set_value_replaces_root() {
        let mut v = json!({"a": 1});
        let op = Op::SetValue {
            path: root(),
            value: json!([1, 2, 3]),
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(v, json!([1, 2, 3]));
        assert_eq!(
            out.inverse,
            Op::SetValue {
                path: root(),
                value: json!({"a": 1}),
            }
        );
    }

    #[test]
    fn set_value_replaces_nested_leaf() {
        let mut v = json!({"events": [{"id": 1}, {"id": 2}]});
        let op = Op::SetValue {
            path: p(vec![k("events"), i(1), k("id")]),
            value: json!(99),
        };
        op.apply(&mut v).unwrap();
        assert_eq!(v, json!({"events": [{"id": 1}, {"id": 99}]}));
    }

    #[test]
    fn set_value_invalid_path_errors() {
        let mut v = json!({"a": 1});
        let op = Op::SetValue {
            path: p(vec![k("missing"), k("inner")]),
            value: json!(0),
        };
        let err = op.apply(&mut v).unwrap_err();
        assert!(matches!(err, DocError::InvalidPath(_)));
    }

    #[test]
    fn set_value_round_trips() {
        round_trip(
            json!({"a": {"b": 1}}),
            Op::SetValue {
                path: p(vec![k("a"), k("b")]),
                value: json!(2),
            },
        );
    }

    #[test]
    fn rename_key_preserves_position() {
        let mut v = json!({"alpha": 1, "beta": 2, "gamma": 3});
        let op = Op::RenameKey {
            path: root(),
            from: "beta".into(),
            to: "BETA".into(),
        };
        op.apply(&mut v).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["alpha", "BETA", "gamma"]);
        assert_eq!(v.pointer("/BETA"), Some(&json!(2)));
    }

    #[test]
    fn rename_key_inverse_renames_back() {
        let mut v = json!({"a": 1, "b": 2});
        let op = Op::RenameKey {
            path: root(),
            from: "a".into(),
            to: "A".into(),
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(
            out.inverse,
            Op::RenameKey {
                path: root(),
                from: "A".into(),
                to: "a".into(),
            }
        );
    }

    #[test]
    fn rename_key_collision_errors() {
        let mut v = json!({"a": 1, "b": 2});
        let op = Op::RenameKey {
            path: root(),
            from: "a".into(),
            to: "b".into(),
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
        assert_eq!(v, json!({"a": 1, "b": 2}));
    }

    #[test]
    fn rename_key_missing_source_errors() {
        let mut v = json!({"a": 1});
        let op = Op::RenameKey {
            path: root(),
            from: "missing".into(),
            to: "b".into(),
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
    }

    #[test]
    fn rename_key_round_trips() {
        round_trip(
            json!({"alpha": 1, "beta": 2, "gamma": 3}),
            Op::RenameKey {
                path: root(),
                from: "beta".into(),
                to: "B".into(),
            },
        );
    }

    #[test]
    fn insert_key_appends_when_no_position() {
        let mut v = json!({"a": 1});
        let op = Op::InsertKey {
            path: root(),
            key: "b".into(),
            value: json!(2),
            position: None,
        };
        op.apply(&mut v).unwrap();
        assert_eq!(v, json!({"a": 1, "b": 2}));
    }

    #[test]
    fn insert_key_with_position_lands_at_index() {
        let mut v = json!({"a": 1, "c": 3});
        let op = Op::InsertKey {
            path: root(),
            key: "b".into(),
            value: json!(2),
            position: Some(1),
        };
        op.apply(&mut v).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["a", "b", "c"]);
    }

    #[test]
    fn insert_key_collision_errors() {
        let mut v = json!({"a": 1});
        let op = Op::InsertKey {
            path: root(),
            key: "a".into(),
            value: json!(99),
            position: None,
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
    }

    #[test]
    fn insert_key_inverse_is_delete_key() {
        let mut v = json!({"a": 1});
        let op = Op::InsertKey {
            path: root(),
            key: "b".into(),
            value: json!(2),
            position: None,
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(
            out.inverse,
            Op::DeleteKey {
                path: root(),
                key: "b".into(),
            }
        );
    }

    #[test]
    fn insert_key_round_trips() {
        round_trip(
            json!({"a": 1, "c": 3}),
            Op::InsertKey {
                path: root(),
                key: "b".into(),
                value: json!(2),
                position: Some(1),
            },
        );
    }

    #[test]
    fn delete_key_removes_and_returns_position_in_inverse() {
        let mut v = json!({"a": 1, "b": 2, "c": 3});
        let op = Op::DeleteKey {
            path: root(),
            key: "b".into(),
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(v, json!({"a": 1, "c": 3}));
        assert_eq!(
            out.inverse,
            Op::InsertKey {
                path: root(),
                key: "b".into(),
                value: json!(2),
                position: Some(1),
            }
        );
    }

    #[test]
    fn delete_key_missing_errors() {
        let mut v = json!({"a": 1});
        let op = Op::DeleteKey {
            path: root(),
            key: "missing".into(),
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
    }

    #[test]
    fn delete_key_round_trips_with_position() {
        round_trip(
            json!({"a": 1, "b": 2, "c": 3}),
            Op::DeleteKey {
                path: root(),
                key: "b".into(),
            },
        );
    }

    #[test]
    fn insert_item_at_index_shifts_tail() {
        let mut v = json!([1, 2, 4]);
        let op = Op::InsertItem {
            path: root(),
            index: 2,
            value: json!(3),
        };
        op.apply(&mut v).unwrap();
        assert_eq!(v, json!([1, 2, 3, 4]));
    }

    #[test]
    fn insert_item_at_len_pushes() {
        let mut v = json!([1, 2]);
        let op = Op::InsertItem {
            path: root(),
            index: 2,
            value: json!(3),
        };
        op.apply(&mut v).unwrap();
        assert_eq!(v, json!([1, 2, 3]));
    }

    #[test]
    fn insert_item_out_of_bounds_errors() {
        let mut v = json!([1, 2]);
        let op = Op::InsertItem {
            path: root(),
            index: 5,
            value: json!(99),
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
    }

    #[test]
    fn insert_item_round_trips() {
        round_trip(
            json!([1, 2, 4]),
            Op::InsertItem {
                path: root(),
                index: 2,
                value: json!(3),
            },
        );
    }

    #[test]
    fn delete_item_removes_and_returns_inverse() {
        let mut v = json!([1, 2, 3]);
        let op = Op::DeleteItem {
            path: root(),
            index: 1,
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(v, json!([1, 3]));
        assert_eq!(
            out.inverse,
            Op::InsertItem {
                path: root(),
                index: 1,
                value: json!(2),
            }
        );
    }

    #[test]
    fn delete_item_out_of_bounds_errors() {
        let mut v = json!([1]);
        let op = Op::DeleteItem {
            path: root(),
            index: 5,
        };
        assert!(matches!(op.apply(&mut v).unwrap_err(), DocError::Edit(_)));
    }

    #[test]
    fn delete_item_round_trips() {
        round_trip(
            json!([1, 2, 3]),
            Op::DeleteItem {
                path: root(),
                index: 1,
            },
        );
    }

    #[test]
    fn move_item_forward_shifts_correctly() {
        let mut v = json!(["a", "b", "c", "d"]);
        Op::MoveItem {
            path: root(),
            from: 0,
            to: 2,
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(v, json!(["b", "c", "a", "d"]));
    }

    #[test]
    fn move_item_backward_shifts_correctly() {
        let mut v = json!(["a", "b", "c", "d"]);
        Op::MoveItem {
            path: root(),
            from: 3,
            to: 1,
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(v, json!(["a", "d", "b", "c"]));
    }

    #[test]
    fn move_item_adjacent_swap_is_a_swap() {
        let mut v = json!([1, 2, 3]);
        Op::MoveItem {
            path: root(),
            from: 0,
            to: 1,
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(v, json!([2, 1, 3]));
    }

    #[test]
    fn move_item_inverse_swaps_indices() {
        let mut v = json!([1, 2, 3, 4]);
        let out = Op::MoveItem {
            path: root(),
            from: 1,
            to: 3,
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(
            out.inverse,
            Op::MoveItem {
                path: root(),
                from: 3,
                to: 1
            }
        );
    }

    #[test]
    fn move_item_out_of_bounds_errors() {
        let mut v = json!([1, 2]);
        assert!(matches!(
            Op::MoveItem {
                path: root(),
                from: 0,
                to: 5
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::Edit(_)
        ));
        assert_eq!(v, json!([1, 2]), "doc unchanged on error");
    }

    #[test]
    fn move_item_same_index_errors() {
        let mut v = json!([1, 2]);
        assert!(matches!(
            Op::MoveItem {
                path: root(),
                from: 1,
                to: 1
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::Edit(_)
        ));
    }

    #[test]
    fn move_item_round_trips() {
        round_trip(
            json!([10, 20, 30, 40]),
            Op::MoveItem {
                path: root(),
                from: 0,
                to: 3,
            },
        );
        round_trip(
            json!([10, 20, 30, 40]),
            Op::MoveItem {
                path: root(),
                from: 3,
                to: 0,
            },
        );
    }

    #[test]
    fn reorder_keys_sets_order_and_keeps_values() {
        let mut v = json!({"a": 1, "b": 2, "c": 3});
        Op::ReorderKeys {
            path: root(),
            order: vec!["c".into(), "a".into(), "b".into()],
        }
        .apply(&mut v)
        .unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["c", "a", "b"]);
        assert_eq!(v.pointer("/a"), Some(&json!(1)));
        assert_eq!(v.pointer("/c"), Some(&json!(3)));
    }

    #[test]
    fn reorder_keys_inverse_restores_original_order() {
        let mut v = json!({"a": 1, "b": 2, "c": 3});
        let out = Op::ReorderKeys {
            path: root(),
            order: vec!["b".into(), "c".into(), "a".into()],
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(
            out.inverse,
            Op::ReorderKeys {
                path: root(),
                order: vec!["a".into(), "b".into(), "c".into()]
            }
        );
    }

    #[test]
    fn reorder_keys_wrong_length_errors() {
        let mut v = json!({"a": 1, "b": 2});
        assert!(matches!(
            Op::ReorderKeys {
                path: root(),
                order: vec!["a".into()]
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::Edit(_)
        ));
    }

    #[test]
    fn reorder_keys_unknown_key_errors() {
        let mut v = json!({"a": 1, "b": 2});
        assert!(matches!(
            Op::ReorderKeys {
                path: root(),
                order: vec!["a".into(), "z".into()]
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::Edit(_)
        ));
    }

    #[test]
    fn reorder_keys_duplicate_errors() {
        let mut v = json!({"a": 1, "b": 2});
        assert!(matches!(
            Op::ReorderKeys {
                path: root(),
                order: vec!["a".into(), "a".into()]
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::Edit(_)
        ));
        assert_eq!(v, json!({"a": 1, "b": 2}), "doc unchanged on error");
    }

    #[test]
    fn reorder_keys_round_trips() {
        round_trip(
            json!({"alpha": 1, "beta": [1, 2], "gamma": {"x": 0}}),
            Op::ReorderKeys {
                path: root(),
                order: vec!["gamma".into(), "alpha".into(), "beta".into()],
            },
        );
    }

    #[test]
    fn reorder_keys_nested_object() {
        let mut v = json!({"outer": {"z": 1, "a": 2}});
        Op::ReorderKeys {
            path: p(vec![k("outer")]),
            order: vec!["a".into(), "z".into()],
        }
        .apply(&mut v)
        .unwrap();
        let keys: Vec<_> = v
            .pointer("/outer")
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, vec!["a", "z"]);
    }

    #[test]
    fn op_serializes_camel_case_kind() {
        let cases = vec![
            (
                Op::SetValue {
                    path: root(),
                    value: json!(0),
                },
                "setValue",
            ),
            (
                Op::RenameKey {
                    path: root(),
                    from: "a".into(),
                    to: "b".into(),
                },
                "renameKey",
            ),
            (
                Op::InsertKey {
                    path: root(),
                    key: "k".into(),
                    value: json!(1),
                    position: None,
                },
                "insertKey",
            ),
            (
                Op::DeleteKey {
                    path: root(),
                    key: "k".into(),
                },
                "deleteKey",
            ),
            (
                Op::InsertItem {
                    path: root(),
                    index: 0,
                    value: json!(0),
                },
                "insertItem",
            ),
            (
                Op::DeleteItem {
                    path: root(),
                    index: 0,
                },
                "deleteItem",
            ),
            (
                Op::MoveItem {
                    path: root(),
                    from: 0,
                    to: 1,
                },
                "moveItem",
            ),
            (
                Op::ReorderKeys {
                    path: root(),
                    order: vec!["b".into(), "a".into()],
                },
                "reorderKeys",
            ),
        ];
        for (op, expected_tag) in cases {
            let json = serde_json::to_string(&op).expect("serialize");
            let needle = format!("\"kind\":\"{expected_tag}\"");
            assert!(json.contains(&needle), "expected {needle} in {json}");
        }
    }

    #[test]
    fn op_round_trips_through_json() {
        let op = Op::InsertKey {
            path: p(vec![k("events"), i(2)]),
            key: "newKey".into(),
            value: json!({"nested": [1, 2, 3]}),
            position: Some(0),
        };
        let json = serde_json::to_string(&op).unwrap();
        let back: Op = serde_json::from_str(&json).unwrap();
        assert_eq!(op, back);
    }

    #[test]
    fn op_outcome_serializes_camel_case() {
        let outcome = OpOutcome {
            inverse: Op::DeleteKey {
                path: root(),
                key: "k".into(),
            },
            affected_paths: vec![root()],
        };
        let json = serde_json::to_string(&outcome).unwrap();
        assert!(json.contains("\"affectedPaths\""));
        assert!(!json.contains("affected_paths"));
    }

    fn key_order(v: &Value, ptr: &[&str]) -> Vec<String> {
        let mut cur = v;
        for k in ptr {
            cur = &cur[k];
        }
        cur.as_object().unwrap().keys().cloned().collect()
    }

    #[test]
    fn sort_keys_recurses_into_nested_objects() {
        let mut v = json!({ "b": 1, "a": { "y": 2, "x": 3 } });
        let op = Op::SortKeys {
            path: root(),
            descending: false,
        };
        let out = op.apply(&mut v).unwrap();
        assert_eq!(key_order(&v, &[]), vec!["a", "b"]);
        assert_eq!(key_order(&v, &["a"]), vec!["x", "y"]); // nested sorted too
        assert_eq!(v["a"]["y"], json!(2)); // values intact

        out.inverse.apply(&mut v).unwrap();
        assert_eq!(key_order(&v, &[]), vec!["b", "a"]);
        assert_eq!(key_order(&v, &["a"]), vec!["y", "x"]);
    }

    #[test]
    fn sort_keys_descending() {
        let mut v = json!({ "a": 1, "c": 3, "b": 2 });
        Op::SortKeys {
            path: root(),
            descending: true,
        }
        .apply(&mut v)
        .unwrap();
        assert_eq!(key_order(&v, &[]), vec!["c", "b", "a"]);
    }

    #[test]
    fn sort_keys_on_non_object_errors() {
        let mut v = json!([3, 1, 2]);
        assert!(matches!(
            Op::SortKeys {
                path: root(),
                descending: false,
            }
            .apply(&mut v)
            .unwrap_err(),
            DocError::InvalidPath(_)
        ));
    }
}
