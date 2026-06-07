use std::collections::BTreeMap;

use serde_json::Value;

use super::document::Document;
use super::types::{Column, ColumnSchema, GridUnsuitableReason, NodeKind, Path, PathSegment};

const FRONT_SAMPLE: u32 = 200;
const SPREAD_SAMPLE: u32 = 800;
#[allow(dead_code)] // used by tests to assert the sample budget
const MAX_TOTAL: u32 = FRONT_SAMPLE + SPREAD_SAMPLE;

const OBJECT_RATIO_MIN: f32 = 0.5;
const COLUMN_PRESENCE_MIN: f32 = 0.5;

pub fn sniff_columns(doc: &Document, path: &Path) -> super::types::DocResult<ColumnSchema> {
    let (kind, count) = doc.kind_at(path)?;

    if kind != NodeKind::Array {
        return Ok(empty_with(GridUnsuitableReason::NotArray, 0));
    }

    let row_count = match count {
        Some(n) => n,
        None => return Ok(empty_with(GridUnsuitableReason::TooDivergent, 0)),
    };

    if row_count == 0 {
        return Ok(empty_with(GridUnsuitableReason::Empty, 0));
    }

    let indices = pick_sample_indices(row_count);
    let sampled = indices.len() as u32;

    let mut object_count: u32 = 0;
    let mut columns: Vec<ColumnAcc> = Vec::new();
    let mut col_index: BTreeMap<String, usize> = BTreeMap::new();

    for i in &indices {
        let mut elem_path = path.clone();
        elem_path.push(PathSegment::Index(*i));
        let value = doc.get_value(&elem_path)?;

        if let Value::Object(map) = value {
            object_count += 1;
            for (k, v) in map.iter() {
                let kind = value_kind(v);
                let idx = match col_index.get(k) {
                    Some(idx) => *idx,
                    None => {
                        let idx = columns.len();
                        col_index.insert(k.clone(), idx);
                        columns.push(ColumnAcc {
                            key: k.clone(),
                            kinds: Vec::new(),
                            kind_counts: Vec::new(),
                            count: 0,
                            null_count: 0,
                        });
                        idx
                    }
                };
                let acc = &mut columns[idx];
                acc.count += 1;
                if matches!(kind, NodeKind::Null) {
                    acc.null_count += 1;
                }
                if let Some(pos) = acc.kinds.iter().position(|k| *k == kind) {
                    acc.kind_counts[pos] += 1;
                } else {
                    acc.kinds.push(kind);
                    acc.kind_counts.push(1);
                }
            }
        }
    }

    let object_ratio = object_count as f32 / sampled as f32;
    if object_ratio < OBJECT_RATIO_MIN {
        return Ok(ColumnSchema {
            grid_suitable: false,
            reason: Some(GridUnsuitableReason::NonObjectElements),
            row_count,
            sampled,
            columns: Vec::new(),
        });
    }

    if columns.is_empty() {
        return Ok(ColumnSchema {
            grid_suitable: false,
            reason: Some(GridUnsuitableReason::TooDivergent),
            row_count,
            sampled,
            columns: Vec::new(),
        });
    }

    let columns_out: Vec<Column> = columns
        .into_iter()
        .map(|acc| {
            let dominant_kind = acc.dominant_kind();
            Column {
                key: acc.key,
                kinds: acc.kinds,
                dominant_kind,
                presence: acc.count as f32 / sampled as f32,
                nullable: acc.null_count > 0,
            }
        })
        .collect();

    let best_presence = columns_out
        .iter()
        .map(|c| c.presence)
        .fold(0.0_f32, f32::max);
    if best_presence < COLUMN_PRESENCE_MIN {
        return Ok(ColumnSchema {
            grid_suitable: false,
            reason: Some(GridUnsuitableReason::TooDivergent),
            row_count,
            sampled,
            columns: columns_out,
        });
    }

    Ok(ColumnSchema {
        grid_suitable: true,
        reason: None,
        row_count,
        sampled,
        columns: columns_out,
    })
}

fn empty_with(reason: GridUnsuitableReason, row_count: u32) -> ColumnSchema {
    ColumnSchema {
        grid_suitable: false,
        reason: Some(reason),
        row_count,
        sampled: 0,
        columns: Vec::new(),
    }
}

fn pick_sample_indices(n: u32) -> Vec<u32> {
    if n == 0 {
        return Vec::new();
    }
    let mut out: Vec<u32> = Vec::new();
    let front_end = n.min(FRONT_SAMPLE);
    out.extend(0..front_end);

    if n > FRONT_SAMPLE {
        let remaining = n - FRONT_SAMPLE;
        let take = remaining.min(SPREAD_SAMPLE);
        if take >= remaining {
            out.extend(FRONT_SAMPLE..n);
        } else {
            for k in 0..take {
                let pos = FRONT_SAMPLE as u64 + (k as u64 * remaining as u64) / take as u64;
                out.push(pos as u32);
            }
            out.sort_unstable();
            out.dedup();
        }
    }

    out
}

fn value_kind(v: &Value) -> NodeKind {
    match v {
        Value::Null => NodeKind::Null,
        Value::Bool(_) => NodeKind::Bool,
        Value::Number(_) => NodeKind::Number,
        Value::String(_) => NodeKind::String,
        Value::Array(_) => NodeKind::Array,
        Value::Object(_) => NodeKind::Object,
    }
}

struct ColumnAcc {
    key: String,
    kinds: Vec<NodeKind>,
    kind_counts: Vec<u32>,
    count: u32,
    null_count: u32,
}

impl ColumnAcc {
    fn dominant_kind(&self) -> NodeKind {
        let mut best = 0usize;
        let mut best_n = self.kind_counts[0];
        for (i, n) in self.kind_counts.iter().enumerate().skip(1) {
            if *n > best_n {
                best_n = *n;
                best = i;
            }
        }
        self.kinds[best]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> Document {
        Document::from_text(text, None).expect("valid JSON in test")
    }

    #[test]
    fn uniform_array_of_objects_is_grid_suitable() {
        let d = doc(r#"[
                {"id": 1, "name": "Ada"},
                {"id": 2, "name": "Linus"},
                {"id": 3, "name": "Grace"}
            ]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.reason, None);
        assert_eq!(s.row_count, 3);
        assert_eq!(s.sampled, 3);
        assert_eq!(s.columns.len(), 2);

        let id = s.columns.iter().find(|c| c.key == "id").unwrap();
        assert_eq!(id.dominant_kind, NodeKind::Number);
        assert_eq!(id.presence, 1.0);
        assert!(!id.nullable);
    }

    #[test]
    fn sparse_keys_use_union_with_presence() {
        let d = doc(r#"[
                {"id": 1, "name": "Ada"},
                {"id": 2, "name": "Linus", "email": "l@x.com"},
                {"id": 3, "name": "Grace", "email": "g@x.com"}
            ]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.columns.len(), 3);

        let email = s.columns.iter().find(|c| c.key == "email").unwrap();
        assert!((email.presence - 2.0 / 3.0).abs() < 1e-5);
        let id = s.columns.iter().find(|c| c.key == "id").unwrap();
        assert_eq!(id.presence, 1.0);
    }

    #[test]
    fn mixed_types_per_column_record_all_kinds() {
        let d = doc(r#"[
                {"amount": 100},
                {"amount": 200},
                {"amount": "N/A"}
            ]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        let amount = &s.columns[0];
        assert!(amount.kinds.contains(&NodeKind::Number));
        assert!(amount.kinds.contains(&NodeKind::String));
        assert_eq!(amount.dominant_kind, NodeKind::Number); // 2 vs 1
    }

    #[test]
    fn null_in_column_sets_nullable() {
        let d = doc(r#"[
                {"email": "a@x.com"},
                {"email": null},
                {"email": "c@x.com"}
            ]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        let email = &s.columns[0];
        assert!(email.nullable);
        assert!(email.kinds.contains(&NodeKind::Null));
        assert!(email.kinds.contains(&NodeKind::String));
    }

    #[test]
    fn non_array_root_is_not_grid_suitable() {
        let d = doc(r#"{"users": []}"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::NotArray));
        assert_eq!(s.columns.len(), 0);
    }

    #[test]
    fn empty_array_returns_empty_reason() {
        let d = doc(r#"[]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::Empty));
        assert_eq!(s.row_count, 0);
    }

    #[test]
    fn array_of_strings_is_non_object_elements() {
        let d = doc(r#"["a", "b", "c"]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::NonObjectElements));
    }

    #[test]
    fn array_with_minority_objects_is_non_object_elements() {
        let d = doc(r#"[{"a": 1}, "b", "c", "d"]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::NonObjectElements));
    }

    #[test]
    fn fully_divergent_keys_are_too_divergent() {
        let d = doc(r#"[{"a": 1}, {"b": 2}, {"c": 3}, {"d": 4}]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::TooDivergent));
    }

    #[test]
    fn array_of_empty_objects_is_too_divergent() {
        let d = doc(r#"[{}, {}, {}]"#);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(!s.grid_suitable);
        assert_eq!(s.reason, Some(GridUnsuitableReason::TooDivergent));
    }

    #[test]
    fn nested_path_to_inner_array() {
        let d = doc(r#"{"users": [{"id": 1}, {"id": 2}]}"#);
        let p = Path(vec![PathSegment::Key("users".into())]);
        let s = sniff_columns(&d, &p).unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.row_count, 2);
        assert_eq!(s.columns.len(), 1);
        assert_eq!(s.columns[0].key, "id");
    }

    #[test]
    fn samples_capped_at_one_thousand_for_huge_array() {
        let mut text = String::from("[");
        for i in 0..5000 {
            if i > 0 {
                text.push(',');
            }
            text.push_str(r#"{"a": 1}"#);
        }
        text.push(']');

        let d = doc(&text);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.row_count, 5000);
        assert_eq!(s.sampled, MAX_TOTAL); // 1000
        assert_eq!(s.columns.len(), 1);
        assert_eq!(s.columns[0].presence, 1.0);
    }

    #[test]
    fn schema_drift_caught_by_spread_sampling() {
        let mut text = String::from("[");
        for i in 0..2000 {
            if i > 0 {
                text.push(',');
            }
            if i < 200 {
                text.push_str(r#"{"a": 1}"#);
            } else {
                text.push_str(r#"{"a": 1, "b": 2}"#);
            }
        }
        text.push(']');

        let d = doc(&text);
        let s = sniff_columns(&d, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        let keys: Vec<&str> = s.columns.iter().map(|c| c.key.as_str()).collect();
        assert!(keys.contains(&"a"));
        assert!(
            keys.contains(&"b"),
            "spread sampling must surface late keys"
        );
    }

    #[test]
    fn pick_sample_indices_small_array() {
        let v = pick_sample_indices(50);
        assert_eq!(v.len(), 50);
        assert_eq!(v[0], 0);
        assert_eq!(v[49], 49);
    }

    #[test]
    fn pick_sample_indices_at_front_boundary() {
        let v = pick_sample_indices(200);
        assert_eq!(v.len(), 200);
    }

    #[test]
    fn pick_sample_indices_under_total_cap() {
        let v = pick_sample_indices(800);
        assert_eq!(v.len(), 800);
    }

    #[test]
    fn pick_sample_indices_above_cap() {
        let v = pick_sample_indices(100_000);
        assert_eq!(v.len(), MAX_TOTAL as usize);
        assert_eq!(v[0], 0);
        let last = *v.last().unwrap();
        assert!(
            last > 99_000,
            "last sampled index {last} should reach the tail"
        );
        assert!(v.windows(2).all(|w| w[0] < w[1]));
    }
}
