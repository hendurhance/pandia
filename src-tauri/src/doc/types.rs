use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum PathSegment {
    Key(String),
    Index(u32),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
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
                PathSegment::Key(k) if is_bare_identifier(k) => write!(f, ".{k}")?,
                PathSegment::Key(k) => write!(f, "[{}]", json_quote(k))?,
                PathSegment::Index(i) => write!(f, "[{i}]")?,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Object,
    Array,
    String,
    Number,
    Bool,
    Null,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub key: PathSegment,
    pub kind: NodeKind,
    pub preview: String,
    pub child_count: Option<u32>,
}

pub(crate) fn quote_preview(s: &str) -> String {
    const MAX: usize = 1000;
    if s.chars().count() > MAX {
        let truncated: String = s.chars().take(MAX).collect();
        format!("\"{truncated}\u{2026}\"")
    } else {
        format!("\"{s}\"")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub grid_suitable: bool,
    pub reason: Option<GridUnsuitableReason>,
    pub row_count: u32,
    pub sampled: u32,
    pub columns: Vec<Column>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum GridUnsuitableReason {
    NotArray,
    Empty,
    NonObjectElements,
    TooDivergent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
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

    #[error("line range too large: {lines} lines requested (limit {limit} per call)")]
    RangeTooLarge { lines: u32, limit: u32 },

    #[error("parse error: {0}")]
    Parse(String),

    #[error("edit error: {0}")]
    Edit(String),

    #[error("schema error: {0}")]
    Schema(String),

    #[error("export error: {0}")]
    Export(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("cancelled")]
    Cancelled,
}

pub type DocResult<T> = Result<T, DocError>;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WireError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
    pub path: Option<Path>,
    pub actual: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    NotFound,
    InvalidPath,
    TooLarge,
    RangeTooLarge,
    Parse,
    Edit,
    Schema,
    Export,
    Io,
    Cancelled,
}

impl From<DocError> for WireError {
    fn from(e: DocError) -> Self {
        let (kind, detail, path, actual, limit) = match &e {
            DocError::NotFound(_) => (ErrorKind::NotFound, None, None, None, None),
            DocError::InvalidPath(p) => (ErrorKind::InvalidPath, None, Some(p.clone()), None, None),
            DocError::TooLarge { actual, limit } => {
                (ErrorKind::TooLarge, None, None, Some(*actual), Some(*limit))
            }
            DocError::RangeTooLarge { lines, limit } => (
                ErrorKind::RangeTooLarge,
                None,
                None,
                Some(u64::from(*lines)),
                Some(u64::from(*limit)),
            ),
            DocError::Parse(s) => (ErrorKind::Parse, Some(s.clone()), None, None, None),
            DocError::Edit(s) => (ErrorKind::Edit, Some(s.clone()), None, None, None),
            DocError::Schema(s) => (ErrorKind::Schema, Some(s.clone()), None, None, None),
            DocError::Export(s) => (ErrorKind::Export, Some(s.clone()), None, None, None),
            DocError::Io(err) => (ErrorKind::Io, Some(err.to_string()), None, None, None),
            DocError::Cancelled => (ErrorKind::Cancelled, None, None, None, None),
        };
        WireError {
            kind,
            message: e.to_string(),
            detail,
            path,
            actual,
            limit,
        }
    }
}

impl From<std::io::Error> for WireError {
    fn from(e: std::io::Error) -> Self {
        WireError::from(DocError::from(e))
    }
}

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
        };
        assert_eq!(roundtrip(&view), view);

        let leaf = NodeView {
            key: PathSegment::Index(0),
            kind: NodeKind::String,
            preview: "\"hello\"".into(),
            child_count: None,
        };
        assert_eq!(roundtrip(&leaf), leaf);
    }

    #[test]
    fn wire_error_too_large_carries_sizes_as_data() {
        let wire = WireError::from(DocError::TooLarge {
            actual: 2_147_483_649,
            limit: 2_147_483_648,
        });
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.contains("\"kind\":\"tooLarge\""));
        assert!(json.contains("\"actual\":2147483649"));
        assert!(json.contains("\"limit\":2147483648"));
    }

    #[test]
    fn wire_error_range_too_large_has_own_kind_and_line_counts() {
        let wire = WireError::from(DocError::RangeTooLarge {
            lines: 12_000,
            limit: 5_000,
        });
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.contains("\"kind\":\"rangeTooLarge\""));
        assert!(json.contains("\"actual\":12000"));
        assert!(json.contains("\"limit\":5000"));
    }

    #[test]
    fn wire_error_without_sizes_serializes_them_as_null() {
        let wire = WireError::from(DocError::Parse("expected value".into()));
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.contains("\"actual\":null"));
        assert!(json.contains("\"limit\":null"));
        assert!(json.contains("\"message\":\"parse error: expected value\""));
    }

    #[test]
    fn wire_error_carries_unprefixed_detail() {
        let wire = WireError::from(DocError::Parse("expected value at line 3".into()));
        assert_eq!(wire.detail.as_deref(), Some("expected value at line 3"));
        assert_eq!(wire.message, "parse error: expected value at line 3");

        let edit = WireError::from(DocError::Edit("key exists".into()));
        assert_eq!(edit.detail.as_deref(), Some("key exists"));
    }

    #[test]
    fn wire_error_invalid_path_carries_structured_path() {
        let p = Path(vec![
            PathSegment::Key("events".into()),
            PathSegment::Index(3),
        ]);
        let wire = WireError::from(DocError::InvalidPath(p.clone()));
        assert_eq!(wire.path, Some(p));
        assert!(wire.detail.is_none());
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.contains("\"path\":[\"events\",3]"));
    }

    #[test]
    fn node_view_serializes_camel_case() {
        let view = NodeView {
            key: PathSegment::Key("events".into()),
            kind: NodeKind::Array,
            preview: "[2 items]".into(),
            child_count: Some(2),
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("\"childCount\":2"));
        assert!(!json.contains("child_count"));
    }
}
