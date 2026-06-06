use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DocHandle(pub uuid::Uuid);

impl DocHandle {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4())
    }
}

impl Default for DocHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for DocHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PathSegment {
    Key(String),
    Index(u32),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Path(pub Vec<PathSegment>);

impl Path {
    pub fn root() -> Self {
        Self(Vec::new())
    }

    pub fn push(&mut self, seg: PathSegment) {
        self.0.push(seg);
    }

    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Display for Path {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("$")?;
        for seg in &self.0 {
            match seg {
                PathSegment::Key(k) if is_bare_identifier(k) => write!(f, ".{}", k)?,
                PathSegment::Key(k) => write!(f, "[{}]", json_quote(k))?,
                PathSegment::Index(i) => write!(f, "[{}]", i)?,
            }
        }
        Ok(())
    }
}

fn is_bare_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.chars().next().unwrap().is_ascii_alphabetic()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn json_quote(s: &str) -> String {
    serde_json::to_string(s).expect("string serialization is infallible")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Object,
    Array,
    String,
    Number,
    Bool,
    Null,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub key: PathSegment,
    pub kind: NodeKind,
    pub preview: String,
    pub child_count: Option<u32>,
    pub size_hint: u32,
}

pub(crate) fn quote_preview(s: &str) -> String {
    const MAX: usize = 1000;
    if s.chars().count() > MAX {
        let truncated: String = s.chars().take(MAX).collect();
        format!("\"{}\u{2026}\"", truncated)
    } else {
        format!("\"{}\"", s)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum WireNumber {
    Safe(f64),
    BigInt(String),
    BigDecimal(String),
}

#[allow(dead_code)]
const SAFE_INTEGER_MAX: i64 = (1i64 << 53) - 1;

impl WireNumber {
    #[allow(dead_code)]
    pub fn classify(token: &str) -> Self {
        let has_fractional = token.bytes().any(|b| matches!(b, b'.' | b'e' | b'E'));

        if !has_fractional {
            if let Ok(n) = token.parse::<i64>() {
                if n.abs() <= SAFE_INTEGER_MAX {
                    return WireNumber::Safe(n as f64);
                }
            }
            return WireNumber::BigInt(token.to_string());
        }

        if let Ok(f) = token.parse::<f64>() {
            if format!("{}", f) == token {
                return WireNumber::Safe(f);
            }
        }
        WireNumber::BigDecimal(token.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub grid_suitable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<GridUnsuitableReason>,
    pub row_count: u32,
    pub sampled: u32,
    pub columns: Vec<Column>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GridUnsuitableReason {
    NotArray,
    Empty,
    NonObjectElements,
    TooDivergent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub key: String,
    pub kinds: Vec<NodeKind>,
    pub dominant_kind: NodeKind,
    pub presence: f32,
    pub nullable: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum DocError {
    #[error("document not found: {0}")]
    NotFound(DocHandle),

    #[error("invalid path: {0}")]
    InvalidPath(Path),

    #[error("document too large: {actual} bytes (limit {limit} bytes)")]
    TooLarge { actual: u64, limit: u64 },

    #[error("parse error: {0}")]
    Parse(String),

    #[error("edit error: {0}")]
    Edit(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("cancelled")]
    Cancelled,
}

pub type DocResult<T> = Result<T, DocError>;

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip<T>(value: &T) -> T
    where
        T: Serialize + for<'de> Deserialize<'de>,
    {
        let json = serde_json::to_string(value).expect("serialize");
        serde_json::from_str(&json).expect("deserialize")
    }

    #[test]
    fn doc_handle_roundtrips_as_uuid_string() {
        let h = DocHandle::new();
        let json = serde_json::to_string(&h).unwrap();
        assert!(json.starts_with('"') && json.ends_with('"'));
        let parsed: DocHandle = serde_json::from_str(&json).unwrap();
        assert_eq!(h, parsed);
    }

    #[test]
    fn path_segment_serializes_untagged() {
        let key = PathSegment::Key("events".into());
        let idx = PathSegment::Index(15);
        assert_eq!(serde_json::to_string(&key).unwrap(), "\"events\"");
        assert_eq!(serde_json::to_string(&idx).unwrap(), "15");
    }

    #[test]
    fn path_serializes_as_segment_array() {
        let path = Path(vec![
            PathSegment::Key("events".into()),
            PathSegment::Index(15),
            PathSegment::Key("timestamp".into()),
        ]);
        let json = serde_json::to_string(&path).unwrap();
        assert_eq!(json, r#"["events",15,"timestamp"]"#);
        assert_eq!(roundtrip(&path), path);
    }

    #[test]
    fn path_display_dot_form_for_bare_identifiers() {
        let p = Path(vec![
            PathSegment::Key("events".into()),
            PathSegment::Index(15),
            PathSegment::Key("timestamp".into()),
        ]);
        assert_eq!(p.to_string(), "$.events[15].timestamp");
    }

    #[test]
    fn path_display_quotes_non_identifier_keys() {
        let p = Path(vec![PathSegment::Key("weird-key".into())]);
        assert_eq!(p.to_string(), r#"$["weird-key"]"#);

        let empty = Path(vec![PathSegment::Key(String::new())]);
        assert_eq!(empty.to_string(), r#"$[""]"#);

        let leading_digit = Path(vec![PathSegment::Key("1abc".into())]);
        assert_eq!(leading_digit.to_string(), r#"$["1abc"]"#);
    }

    #[test]
    fn path_display_root() {
        assert_eq!(Path::root().to_string(), "$");
    }

    #[test]
    fn node_kind_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&NodeKind::Object).unwrap(),
            "\"object\""
        );
        assert_eq!(serde_json::to_string(&NodeKind::Null).unwrap(), "\"null\"");
        assert_eq!(roundtrip(&NodeKind::Number), NodeKind::Number);
    }

    #[test]
    fn node_view_roundtrips() {
        let view = NodeView {
            key: PathSegment::Key("events".into()),
            kind: NodeKind::Array,
            preview: "[109472 items]".into(),
            child_count: Some(109_472),
            size_hint: 12_345,
        };
        assert_eq!(roundtrip(&view), view);

        let leaf = NodeView {
            key: PathSegment::Index(0),
            kind: NodeKind::String,
            preview: "\"hello\"".into(),
            child_count: None,
            size_hint: 7,
        };
        assert_eq!(roundtrip(&leaf), leaf);
    }

    #[test]
    fn wire_number_tags_each_variant() {
        let safe = WireNumber::Safe(42.0);
        let json = serde_json::to_string(&safe).unwrap();
        assert!(json.contains("\"kind\":\"safe\""));
        assert_eq!(roundtrip(&safe), safe);

        let big = WireNumber::BigInt("18446744073709551615".into());
        let json = serde_json::to_string(&big).unwrap();
        assert!(json.contains("\"kind\":\"bigInt\""));
        assert_eq!(roundtrip(&big), big);

        let dec = WireNumber::BigDecimal("3.141592653589793238462643383279".into());
        let json = serde_json::to_string(&dec).unwrap();
        assert!(json.contains("\"kind\":\"bigDecimal\""));
        assert_eq!(roundtrip(&dec), dec);
    }

    #[test]
    fn wire_number_classify_safe_integers() {
        assert_eq!(WireNumber::classify("0"), WireNumber::Safe(0.0));
        assert_eq!(WireNumber::classify("42"), WireNumber::Safe(42.0));
        assert_eq!(WireNumber::classify("-7"), WireNumber::Safe(-7.0));
        let max_safe = (1i64 << 53) - 1;
        let s = max_safe.to_string();
        assert_eq!(WireNumber::classify(&s), WireNumber::Safe(max_safe as f64));
    }

    #[test]
    fn wire_number_classify_big_integers() {
        let snowflake = "1234567890123456789";
        match WireNumber::classify(snowflake) {
            WireNumber::BigInt(s) => assert_eq!(s, snowflake),
            other => panic!("expected BigInt, got {:?}", other),
        }

        let token = "18446744073709551615";
        match WireNumber::classify(token) {
            WireNumber::BigInt(s) => assert_eq!(s, token),
            other => panic!("expected BigInt, got {:?}", other),
        }
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn wire_number_classify_safe_decimals() {
        match WireNumber::classify("3.14") {
            WireNumber::Safe(f) => assert!((f - 3.14).abs() < 1e-12),
            other => panic!("expected Safe, got {:?}", other),
        }
    }

    #[test]
    fn wire_number_classify_big_decimals() {
        let token = "3.141592653589793238462643383279";
        match WireNumber::classify(token) {
            WireNumber::BigDecimal(s) => assert_eq!(s, token),
            other => panic!("expected BigDecimal, got {:?}", other),
        }
    }

    #[test]
    fn node_view_serializes_camel_case() {
        let view = NodeView {
            key: PathSegment::Key("events".into()),
            kind: NodeKind::Array,
            preview: "[2 items]".into(),
            child_count: Some(2),
            size_hint: 0,
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("\"childCount\":2"));
        assert!(json.contains("\"sizeHint\":0"));
        assert!(!json.contains("child_count"));
        assert!(!json.contains("size_hint"));
    }
}
