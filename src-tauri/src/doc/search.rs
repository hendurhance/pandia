use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::jobs::CancelFlag;
use super::types::{NodeKind, Path, PathSegment};

const DEFAULT_MAX_RESULTS: u32 = 10_000;
const SNIPPET_BEFORE: usize = 24;
const SNIPPET_AFTER: usize = 36;
const PREVIEW_CHAR_CAP: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchField {
    Key,
    Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: Path,
    pub kind: NodeKind,
    pub match_field: MatchField,
    pub snippet: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub max_results: u32,
}

pub(crate) fn prepare(opts: &SearchOptions) -> Option<(String, usize)> {
    let cap = if opts.max_results == 0 {
        DEFAULT_MAX_RESULTS as usize
    } else {
        opts.max_results as usize
    };
    let needle = if opts.case_sensitive {
        opts.query.clone()
    } else {
        opts.query.to_lowercase()
    };
    if needle.is_empty() {
        return None;
    }
    Some((needle, cap))
}

pub fn search_in_value(root: &Value, opts: &SearchOptions, cancel: &CancelFlag) -> Vec<SearchHit> {
    let Some((needle, cap)) = prepare(opts) else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    let mut path = Path::root();
    walk(
        root,
        &mut path,
        &needle,
        opts.case_sensitive,
        cap,
        &mut hits,
        cancel,
    );
    hits
}

fn walk(
    value: &Value,
    path: &mut Path,
    needle: &str,
    case_sensitive: bool,
    cap: usize,
    hits: &mut Vec<SearchHit>,
    cancel: &CancelFlag,
) {
    if cancel.is_cancelled() {
        return;
    }
    if hits.len() >= cap {
        return;
    }
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if hits.len() >= cap {
                    return;
                }
                let key_hit = substr_contains(k, needle, case_sensitive);
                if key_hit {
                    path.push(PathSegment::Key(k.clone()));
                    hits.push(SearchHit {
                        path: path.clone(),
                        kind: kind_of(v),
                        match_field: MatchField::Key,
                        snippet: format!("{}: {}", k, preview_of(v)),
                    });
                    path.0.pop();
                }
                path.push(PathSegment::Key(k.clone()));
                walk(v, path, needle, case_sensitive, cap, hits, cancel);
                path.0.pop();
            }
        }
        Value::Array(arr) => {
            for (i, v) in arr.iter().enumerate() {
                if hits.len() >= cap {
                    return;
                }
                path.push(PathSegment::Index(i as u32));
                walk(v, path, needle, case_sensitive, cap, hits, cancel);
                path.0.pop();
            }
        }
        Value::String(s) => {
            if let Some(snippet) = string_match_snippet(s, needle, case_sensitive) {
                hits.push(SearchHit {
                    path: path.clone(),
                    kind: NodeKind::String,
                    match_field: MatchField::Value,
                    snippet,
                });
            }
        }
        _ => {}
    }
}

pub(crate) fn substr_contains(haystack: &str, needle: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        haystack.contains(needle)
    } else {
        haystack.to_lowercase().contains(needle)
    }
}

pub(crate) fn string_match_snippet(s: &str, needle: &str, case_sensitive: bool) -> Option<String> {
    let idx = if case_sensitive {
        s.find(needle)?
    } else {
        let lower = s.to_lowercase();
        lower.find(needle)?
    };
    Some(make_snippet(s, idx, needle.len()))
}

fn make_snippet(text: &str, byte_idx: usize, match_len: usize) -> String {
    let len = text.len();
    let raw_start = byte_idx.saturating_sub(SNIPPET_BEFORE);
    let raw_end = (byte_idx + match_len + SNIPPET_AFTER).min(len);
    let start = nearest_boundary(text, raw_start, true);
    let end = nearest_boundary(text, raw_end, false);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < len { "…" } else { "" };
    format!("\"{}{}{}\"", prefix, &text[start..end], suffix)
}

fn nearest_boundary(s: &str, idx: usize, walking_back: bool) -> usize {
    let mut i = idx;
    if walking_back {
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
    } else {
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
    }
    i
}

fn preview_of(v: &Value) -> String {
    match v {
        Value::String(s) => {
            let chars: Vec<char> = s.chars().take(PREVIEW_CHAR_CAP).collect();
            let truncated = chars.len() < s.chars().count();
            let body: String = chars.into_iter().collect();
            if truncated {
                format!("\"{}…\"", body)
            } else {
                format!("\"{}\"", body)
            }
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Object(m) => format!("{{{} keys}}", m.len()),
        Value::Array(a) => format!("[{} items]", a.len()),
    }
}

fn kind_of(v: &Value) -> NodeKind {
    match v {
        Value::Object(_) => NodeKind::Object,
        Value::Array(_) => NodeKind::Array,
        Value::String(_) => NodeKind::String,
        Value::Number(_) => NodeKind::Number,
        Value::Bool(_) => NodeKind::Bool,
        Value::Null => NodeKind::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(q: &str) -> SearchOptions {
        SearchOptions {
            query: q.to_string(),
            case_sensitive: false,
            max_results: 0,
        }
    }

    #[test]
    fn empty_query_returns_no_hits() {
        let v = json!({"name": "Ada", "age": 36});
        assert!(search_in_value(&v, &opts(""), &CancelFlag::never()).is_empty());
    }

    #[test]
    fn matches_object_key() {
        let v = json!({"name": "Ada", "age": 36});
        let hits = search_in_value(&v, &opts("name"), &CancelFlag::never());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_field, MatchField::Key);
        assert_eq!(hits[0].kind, NodeKind::String);
        assert!(hits[0].snippet.contains("Ada"));
    }

    #[test]
    fn matches_string_value() {
        let v = json!({"name": "Ada Lovelace"});
        let hits = search_in_value(&v, &opts("lovelace"), &CancelFlag::never());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_field, MatchField::Value);
        assert_eq!(format!("{}", hits[0].path), "$.name");
    }

    #[test]
    fn case_insensitive_by_default() {
        let v = json!({"Name": "ADA"});
        let hits = search_in_value(&v, &opts("ada"), &CancelFlag::never());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_field, MatchField::Value);
    }

    #[test]
    fn case_sensitive_opt_in() {
        let v = json!({"Name": "ADA"});
        let hits = search_in_value(
            &v,
            &SearchOptions {
                query: "ada".to_string(),
                case_sensitive: true,
                max_results: 0,
            },
            &CancelFlag::never(),
        );
        assert!(hits.is_empty());
    }

    #[test]
    fn nested_arrays_and_objects() {
        let v = json!({
            "events": [
                {"msg": "hello world"},
                {"msg": "goodbye world"},
                {"msg": "another line"}
            ]
        });
        let hits = search_in_value(&v, &opts("world"), &CancelFlag::never());
        assert_eq!(hits.len(), 2);
        assert_eq!(format!("{}", hits[0].path), "$.events[0].msg");
        assert_eq!(format!("{}", hits[1].path), "$.events[1].msg");
    }

    #[test]
    fn key_match_and_value_match_emit_separate_hits() {
        let v = json!({"world": "hello world"});
        let hits = search_in_value(&v, &opts("world"), &CancelFlag::never());
        assert_eq!(hits.len(), 2);
        let kinds: Vec<_> = hits.iter().map(|h| h.match_field).collect();
        assert!(kinds.contains(&MatchField::Key));
        assert!(kinds.contains(&MatchField::Value));
    }

    #[test]
    fn cap_caps_results() {
        let mut arr = Vec::new();
        for i in 0..50 {
            arr.push(json!({"msg": format!("hello {i}")}));
        }
        let v = Value::Array(arr);
        let hits = search_in_value(
            &v,
            &SearchOptions {
                query: "hello".to_string(),
                case_sensitive: false,
                max_results: 10,
            },
            &CancelFlag::never(),
        );
        assert_eq!(hits.len(), 10);
    }

    #[test]
    fn snippet_handles_multibyte_safely() {
        let body = format!("{}🦀{}", "x".repeat(20), "y".repeat(50));
        let v = json!({ "msg": body });
        let hits = search_in_value(&v, &opts("🦀"), &CancelFlag::never());
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("🦀"));
    }

    #[test]
    fn does_not_match_non_string_primitives() {
        let v = json!({"count": 42, "ok": true, "x": null});
        let hits = search_in_value(&v, &opts("42"), &CancelFlag::never());
        assert!(hits.is_empty(), "numbers should not match string queries");
    }

    #[test]
    fn root_array_with_string_match() {
        let v = json!(["alpha", "beta", "gamma"]);
        let hits = search_in_value(&v, &opts("amma"), &CancelFlag::never());
        assert_eq!(hits.len(), 1);
        assert_eq!(format!("{}", hits[0].path), "$[2]");
    }
}
