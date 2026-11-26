use std::borrow::Cow;
use std::cmp::Ordering;

use serde_json::Value;

use super::lazy::parse_json;
use super::wire::cmp_number_tokens;

#[derive(Debug, Clone)]
pub enum Cell<'a> {
    Null,
    Bool(bool),
    Num(&'a str),
    Str(&'a str),
    OwnedStr(Box<str>),
    Tree(&'a Value),
    Raw {
        raw: &'a str,
        len: u32,
        object: bool,
    },
}

impl<'a> Cell<'a> {
    pub fn from_value(v: Option<&'a Value>) -> Self {
        match v {
            None | Some(Value::Null) => Cell::Null,
            Some(Value::Bool(b)) => Cell::Bool(*b),
            Some(Value::Number(n)) => Cell::Num(n.as_str()),
            Some(Value::String(s)) => Cell::Str(s),
            Some(v) => Cell::Tree(v),
        }
    }

    pub fn text(&self) -> Option<&str> {
        match self {
            Cell::Str(s) => Some(s),
            Cell::OwnedStr(s) => Some(s),
            _ => None,
        }
    }

    pub fn number(&self) -> Option<&str> {
        match self {
            Cell::Num(t) => Some(t),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Cell::Null)
    }

    pub fn scalar_text(&self) -> Option<Cow<'_, str>> {
        match self {
            Cell::Num(t) => Some(Cow::Borrowed(t)),
            Cell::Bool(b) => Some(Cow::Borrowed(if *b { "true" } else { "false" })),
            _ => self.text().map(Cow::Borrowed),
        }
    }

    pub fn to_value(&self) -> Value {
        match self {
            Cell::Null => Value::Null,
            Cell::Bool(b) => Value::Bool(*b),
            Cell::Num(t) => parse_json(t).unwrap_or(Value::Null),
            Cell::Str(s) => Value::String((*s).to_string()),
            Cell::OwnedStr(s) => Value::String(s.to_string()),
            Cell::Tree(v) => (*v).clone(),
            Cell::Raw { raw, .. } => parse_json(raw).unwrap_or(Value::Null),
        }
    }

    pub fn equals_value(&self, other: Option<&Value>) -> bool {
        match (self, other) {
            (Cell::Null, None | Some(Value::Null)) => true,
            (Cell::Tree(v), Some(o)) => *v == o,
            (Cell::Raw { raw, .. }, Some(o @ (Value::Array(_) | Value::Object(_)))) => {
                parse_json::<Value>(raw).is_ok_and(|v| v == *o)
            }
            _ => false,
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Cell::Null => 0,
            Cell::Bool(_) => 1,
            Cell::Num(_) => 2,
            Cell::Str(_) | Cell::OwnedStr(_) => 3,
            Cell::Tree(Value::Object(_)) | Cell::Raw { object: true, .. } => 5,
            Cell::Tree(_) | Cell::Raw { .. } => 4,
        }
    }

    fn len(&self) -> usize {
        match self {
            Cell::Tree(Value::Array(a)) => a.len(),
            Cell::Tree(Value::Object(o)) => o.len(),
            Cell::Raw { len, .. } => *len as usize,
            _ => 0,
        }
    }
}

impl PartialEq for Cell<'_> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Cell::Null, Cell::Null) => true,
            (Cell::Bool(a), Cell::Bool(b)) => a == b,
            (Cell::Num(a), Cell::Num(b)) => a == b,
            (Cell::Tree(a), Cell::Tree(b)) => a == b,
            _ => match (self.text(), other.text()) {
                (Some(a), Some(b)) => a == b,
                _ => self.rank() == other.rank() && self.to_value() == other.to_value(),
            },
        }
    }
}

pub fn cmp_cells(a: &Cell, b: &Cell) -> Ordering {
    let (ra, rb) = (a.rank(), b.rank());
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (Cell::Bool(x), Cell::Bool(y)) => x.cmp(y),
        (Cell::Num(x), Cell::Num(y)) => cmp_number_tokens(x, y).unwrap_or_else(|| {
            let f = |t: &str| t.parse::<f64>().unwrap_or(f64::NAN);
            f(x).partial_cmp(&f(y)).unwrap_or(Ordering::Equal)
        }),
        _ => match (a.text(), b.text()) {
            (Some(x), Some(y)) => x.cmp(y),
            _ => a.len().cmp(&b.len()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::eager::cmp_cell;
    use serde_json::json;

    #[test]
    fn a_cell_is_24_bytes() {
        assert_eq!(std::mem::size_of::<Cell>(), 24);
    }

    #[test]
    fn cells_sort_exactly_like_values() {
        let values: Vec<Option<Value>> = vec![
            None,
            Some(json!(null)),
            Some(json!(true)),
            Some(json!(false)),
            Some(serde_json::from_str("1075283027435454465").unwrap()),
            Some(serde_json::from_str("1075283027435454464").unwrap()),
            Some(json!(2.5)),
            Some(serde_json::from_str("1e0").unwrap()),
            Some(json!("b")),
            Some(json!("a")),
            Some(json!([1, 2])),
            Some(json!([1])),
            Some(json!({"a": 1, "b": 2})),
            Some(json!({"a": 1})),
        ];
        for a in &values {
            for b in &values {
                assert_eq!(
                    cmp_cells(&Cell::from_value(a.as_ref()), &Cell::from_value(b.as_ref())),
                    cmp_cell(a.as_ref(), b.as_ref()),
                    "{a:?} vs {b:?}"
                );
            }
        }
    }

    #[test]
    fn a_cell_turns_back_into_the_value_it_came_from() {
        for v in [
            json!(null),
            json!(true),
            json!(-3.25),
            json!("x\ny"),
            json!([1, {"a": 2}]),
        ] {
            assert_eq!(Cell::from_value(Some(&v)).to_value(), v);
        }
        let big: Value = serde_json::from_str("123456789012345678901234567890").unwrap();
        assert_eq!(Cell::from_value(Some(&big)).to_value(), big);
    }
}
