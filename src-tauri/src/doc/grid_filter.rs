
use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Contains,
    NotContains,
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    IsEmpty,
    IsNotEmpty,
    In,
    NotIn,
    StartsWith,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridFilter {
    pub key: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Option<Value>,
}

pub fn matches(cell: Option<&Value>, f: &GridFilter) -> bool {
    match f.op {
        FilterOp::IsEmpty => is_empty(cell),
        FilterOp::IsNotEmpty => !is_empty(cell),
        FilterOp::Contains => cell_string(cell)
            .map(|s| contains_ci(&s, &operand_string(f)))
            .unwrap_or(false),
        FilterOp::NotContains => !cell_string(cell)
            .map(|s| contains_ci(&s, &operand_string(f)))
            .unwrap_or(false),
        FilterOp::Eq => value_eq(cell, f.value.as_ref()),
        FilterOp::Ne => !value_eq(cell, f.value.as_ref()),
        FilterOp::Gt => num_cmp(cell, f) == Some(Ordering::Greater),
        FilterOp::Gte => matches!(num_cmp(cell, f), Some(Ordering::Greater | Ordering::Equal)),
        FilterOp::Lt => num_cmp(cell, f) == Some(Ordering::Less),
        FilterOp::Lte => matches!(num_cmp(cell, f), Some(Ordering::Less | Ordering::Equal)),
        FilterOp::In => match &f.value {
            Some(Value::Array(opts)) => opts.iter().any(|o| value_eq(cell, Some(o))),
            _ => false,
        },
        FilterOp::NotIn => match &f.value {
            Some(Value::Array(opts)) => !opts.iter().any(|o| value_eq(cell, Some(o))),
            _ => true,
        },
        FilterOp::StartsWith => cell_string(cell)
            .map(|s| {
                s.to_lowercase()
                    .starts_with(&operand_string(f).to_lowercase())
            })
            .unwrap_or(false),
    }
}

pub fn row_passes<'a, F>(groups: &[Vec<GridFilter>], cell_for: F) -> bool
where
    F: Fn(&str) -> Option<&'a Value>,
{
    groups.is_empty()
        || groups
            .iter()
            .any(|grp| grp.iter().all(|f| matches(cell_for(&f.key), f)))
}

fn is_empty(cell: Option<&Value>) -> bool {
    match cell {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        _ => false,
    }
}

fn cell_string(cell: Option<&Value>) -> Option<String> {
    match cell? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn operand_string(f: &GridFilter) -> String {
    match &f.value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

fn value_eq(cell: Option<&Value>, operand: Option<&Value>) -> bool {
    match (cell, operand) {
        (Some(Value::Number(a)), Some(Value::Number(b))) => a.as_f64() == b.as_f64(),
        _ => {
            if let (Some(a), Some(b)) = (cell.and_then(as_f64), operand_f64_v(operand)) {
                return a == b;
            }
            scalar_str(cell) == scalar_str(operand)
        }
    }
}

fn scalar_str(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null => None,
        _ => None,
    }
}

fn as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn operand_f64_v(operand: Option<&Value>) -> Option<f64> {
    as_f64(operand?)
}

fn num_cmp(cell: Option<&Value>, f: &GridFilter) -> Option<Ordering> {
    let c = as_f64(cell?)?;
    let o = operand_f64_v(f.value.as_ref())?;
    c.partial_cmp(&o)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn f(op: FilterOp, value: Value) -> GridFilter {
        GridFilter {
            key: "x".into(),
            op,
            value: Some(value),
        }
    }

    #[test]
    fn contains_is_case_insensitive() {
        let flt = f(FilterOp::Contains, json!("sind"));
        assert!(matches(Some(&json!("Sindhi")), &flt));
        assert!(!matches(Some(&json!("English")), &flt));
        assert!(!matches(None, &flt));
    }

    #[test]
    fn numeric_comparisons() {
        assert!(matches(Some(&json!(6.1)), &f(FilterOp::Gt, json!(5))));
        assert!(!matches(Some(&json!(4)), &f(FilterOp::Gt, json!(5))));
        assert!(matches(Some(&json!(5)), &f(FilterOp::Gte, json!(5))));
        assert!(matches(Some(&json!(3)), &f(FilterOp::Lte, json!(3))));
        assert!(matches(Some(&json!(6.1)), &f(FilterOp::Gt, json!("5"))));
    }

    #[test]
    fn equality_across_types() {
        assert!(matches(
            Some(&json!("Sindhi")),
            &f(FilterOp::Eq, json!("Sindhi"))
        ));
        assert!(matches(Some(&json!(6.1)), &f(FilterOp::Eq, json!(6.1))));
        assert!(matches(Some(&json!(6.1)), &f(FilterOp::Eq, json!("6.1"))));
        assert!(matches(Some(&json!(true)), &f(FilterOp::Eq, json!(true))));
        assert!(matches(Some(&json!("a")), &f(FilterOp::Ne, json!("b"))));
    }

    #[test]
    fn in_set() {
        let in_set = GridFilter {
            key: "x".into(),
            op: FilterOp::In,
            value: Some(json!(["Sindhi", "Urdu"])),
        };
        assert!(matches(Some(&json!("Sindhi")), &in_set));
        assert!(matches(Some(&json!("Urdu")), &in_set));
        assert!(!matches(Some(&json!("English")), &in_set));
    }

    #[test]
    fn not_in_and_starts_with() {
        let not_in = GridFilter {
            key: "x".into(),
            op: FilterOp::NotIn,
            value: Some(json!(["English"])),
        };
        assert!(matches(Some(&json!("Sindhi")), &not_in));
        assert!(!matches(Some(&json!("English")), &not_in));
        assert!(matches(None, &not_in)); // absent is "not one of"

        let sw = f(FilterOp::StartsWith, json!("Ad"));
        assert!(matches(Some(&json!("Adeel")), &sw));
        assert!(matches(Some(&json!("adeel")), &sw)); // case-insensitive
        assert!(!matches(Some(&json!("Bo")), &sw));
    }

    #[test]
    fn row_passes_or_of_and_groups() {
        use std::collections::HashMap;
        let row: HashMap<&str, Value> = HashMap::from([
            ("role", json!("admin")),
            ("signup", json!(2021)),
            ("active", json!(true)),
        ]);
        let cell = |k: &str| row.get(k);

        let eq = |key: &str, v: Value| GridFilter {
            key: key.into(),
            op: FilterOp::Eq,
            value: Some(v),
        };
        let admin = eq("role", json!("admin"));
        let editor = eq("role", json!("editor"));
        let active = eq("active", json!(true));
        let pre2023 = GridFilter {
            key: "signup".into(),
            op: FilterOp::Lt,
            value: Some(json!(2023)),
        };
        let post2023 = GridFilter {
            key: "signup".into(),
            op: FilterOp::Gt,
            value: Some(json!(2023)),
        };

        assert!(row_passes(&[], &cell));
        assert!(row_passes(&[vec![admin.clone(), active.clone()]], &cell));
        assert!(!row_passes(&[vec![editor.clone(), active]], &cell));
        assert!(row_passes(&[vec![editor.clone()], vec![pre2023]], &cell));
        assert!(!row_passes(&[vec![editor], vec![post2023]], &cell));
    }

    #[test]
    fn empty_and_absent() {
        let empty = GridFilter {
            key: "x".into(),
            op: FilterOp::IsEmpty,
            value: None,
        };
        assert!(matches(None, &empty)); // absent
        assert!(matches(Some(&json!(null)), &empty));
        assert!(matches(Some(&json!("")), &empty));
        assert!(!matches(Some(&json!("a")), &empty));

        let not_empty = GridFilter {
            key: "x".into(),
            op: FilterOp::IsNotEmpty,
            value: None,
        };
        assert!(matches(Some(&json!("a")), &not_empty));
        assert!(!matches(None, &not_empty));
    }
}
