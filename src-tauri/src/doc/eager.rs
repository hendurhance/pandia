use std::ops::Range;

use regex::Regex;
use serde_json::Value;

use super::types::{quote_preview, DocError, DocResult, NodeKind, NodeView, Path, PathSegment};

pub(crate) fn slice_eager(
    root: &Value,
    path: &Path,
    range: Range<u32>,
) -> DocResult<Vec<NodeView>> {
    let target = resolve_eager(root, path)?;
    let start = range.start as usize;
    let end = range.end as usize;
    if end <= start {
        return Ok(Vec::new());
    }

    match target {
        Value::Object(map) => Ok(map
            .iter()
            .skip(start)
            .take(end - start)
            .map(|(k, v)| node_view_eager(PathSegment::Key(k.clone()), v))
            .collect()),
        Value::Array(arr) => {
            let actual_end = end.min(arr.len());
            if start >= actual_end {
                return Ok(Vec::new());
            }
            Ok(arr[start..actual_end]
                .iter()
                .enumerate()
                .map(|(offset, v)| node_view_eager(PathSegment::Index((start + offset) as u32), v))
                .collect())
        }
        _ => Ok(Vec::new()),
    }
}

pub(crate) fn resolve_eager<'a>(root: &'a Value, path: &Path) -> DocResult<&'a Value> {
    let mut cur = root;
    for seg in &path.0 {
        cur = match (cur, seg) {
            (Value::Object(map), PathSegment::Key(k)) => map
                .get(k)
                .ok_or_else(|| DocError::InvalidPath(path.clone()))?,
            (Value::Array(arr), PathSegment::Index(i)) => arr
                .get(*i as usize)
                .ok_or_else(|| DocError::InvalidPath(path.clone()))?,
            _ => return Err(DocError::InvalidPath(path.clone())),
        };
    }
    Ok(cur)
}

pub(crate) fn node_view_eager(key: PathSegment, value: &Value) -> NodeView {
    let (kind, child_count) = kind_and_child_count_eager(value);
    NodeView {
        key,
        kind,
        preview: preview_eager(value),
        child_count,
    }
}

pub(crate) fn kind_and_child_count_eager(v: &Value) -> (NodeKind, Option<u32>) {
    match v {
        Value::Object(m) => (NodeKind::Object, Some(m.len() as u32)),
        Value::Array(a) => (NodeKind::Array, Some(a.len() as u32)),
        Value::String(_) => (NodeKind::String, None),
        Value::Number(_) => (NodeKind::Number, None),
        Value::Bool(_) => (NodeKind::Bool, None),
        Value::Null => (NodeKind::Null, None),
    }
}

pub(crate) fn replace_in_value(v: &mut Value, re: &Regex, repl: &str, count: &mut u32) {
    match v {
        Value::String(s) => {
            let c = re.find_iter(s).count() as u32;
            if c > 0 {
                *count += c;
                *s = re.replace_all(s, regex::NoExpand(repl)).into_owned();
            }
        }
        Value::Array(arr) => {
            for el in arr.iter_mut() {
                replace_in_value(el, re, repl, count);
            }
        }
        Value::Object(map) => {
            let entries: Vec<(String, Value)> = std::mem::take(map).into_iter().collect();
            for (k, mut val) in entries {
                replace_in_value(&mut val, re, repl, count);
                let kc = re.find_iter(&k).count() as u32;
                let key = if kc > 0 {
                    let candidate = re.replace_all(&k, regex::NoExpand(repl)).into_owned();
                    if candidate != k && !map.contains_key(&candidate) {
                        *count += kc;
                        candidate
                    } else {
                        k
                    }
                } else {
                    k
                };
                map.insert(key, val);
            }
        }
        _ => {}
    }
}

pub(crate) fn cell<'a>(el: &'a Value, key: &str) -> Option<&'a Value> {
    el.as_object().and_then(|m| m.get(key))
}

pub(crate) fn eager_cell_text_lower(el: &Value, key: &str) -> Option<String> {
    match cell(el, key)? {
        Value::String(s) => Some(s.to_lowercase()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

pub(crate) fn cmp_cell(a: Option<&Value>, b: Option<&Value>) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    fn rank(v: Option<&Value>) -> u8 {
        match v {
            None | Some(Value::Null) => 0,
            Some(Value::Bool(_)) => 1,
            Some(Value::Number(_)) => 2,
            Some(Value::String(_)) => 3,
            Some(Value::Array(_)) => 4,
            Some(Value::Object(_)) => 5,
        }
    }
    let (ra, rb) = (rank(a), rank(b));
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x.cmp(y),
        (Some(Value::Number(x)), Some(Value::Number(y))) => x
            .as_f64()
            .unwrap_or(f64::NAN)
            .partial_cmp(&y.as_f64().unwrap_or(f64::NAN))
            .unwrap_or(Ordering::Equal),
        (Some(Value::String(x)), Some(Value::String(y))) => x.cmp(y),
        (Some(Value::Array(x)), Some(Value::Array(y))) => x.len().cmp(&y.len()),
        (Some(Value::Object(x)), Some(Value::Object(y))) => x.len().cmp(&y.len()),
        _ => Ordering::Equal,
    }
}

pub(crate) fn preview_eager(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => quote_preview(s),
        Value::Array(a) if a.is_empty() => "[]".into(),
        Value::Array(a) => format!("[{} items]", a.len()),
        Value::Object(m) if m.is_empty() => "{}".into(),
        Value::Object(m) => format!("{{{} keys}}", m.len()),
    }
}

impl super::backend::DocumentBackend for Value {
    fn root_kind_and_count(&self) -> (NodeKind, Option<u32>) {
        kind_and_child_count_eager(self)
    }

    fn slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>> {
        slice_eager(self, path, range)
    }

    fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        Ok(kind_and_child_count_eager(resolve_eager(self, path)?))
    }

    fn child_count_at(&self, path: &Path) -> DocResult<Option<u32>> {
        Ok(kind_and_child_count_eager(resolve_eager(self, path)?).1)
    }

    fn get_value(&self, path: &Path) -> DocResult<Value> {
        Ok(resolve_eager(self, path)?.clone())
    }

    fn column_cells(&self, path: &Path, key: &str) -> DocResult<Vec<Option<Value>>> {
        match resolve_eager(self, path) {
            Ok(Value::Array(arr)) => Ok(arr.iter().map(|el| cell(el, key).cloned()).collect()),
            _ => Ok(Vec::new()),
        }
    }

    fn column_text_lower(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>> {
        match resolve_eager(self, path) {
            Ok(Value::Array(arr)) => Ok(arr
                .iter()
                .map(|el| eager_cell_text_lower(el, key))
                .collect()),
            _ => Ok(Vec::new()),
        }
    }

    fn search(
        &self,
        opts: &super::search::SearchOptions,
        cancel: &super::jobs::CancelFlag,
    ) -> Vec<super::search::SearchHit> {
        super::search::search_in_value(self, opts, cancel)
    }

    fn generate_types(
        &self,
        lang: super::typegen::TypegenLang,
        type_name: &str,
    ) -> DocResult<String> {
        Ok(super::typegen::generate(self, lang, type_name))
    }

    fn hash_into(&self, hasher: &mut blake3::Hasher) -> Result<(), ()> {
        serde_json::to_writer(hasher, self).map_err(|_| ())
    }

    fn serialize_pretty(&self) -> DocResult<String> {
        serde_json::to_string_pretty(self).map_err(|e| DocError::Export(e.to_string()))
    }

    fn serialize_ndjson(&self) -> Option<String> {
        match self {
            Value::Array(items) => {
                let mut out = String::new();
                for v in items {
                    out.push_str(&serde_json::to_string(v).ok()?);
                    out.push('\n');
                }
                Some(out)
            }
            _ => None,
        }
    }

    fn write_json(
        &self,
        pretty: bool,
        w: &mut dyn std::io::Write,
    ) -> Result<(), super::export::ExportError> {
        super::export::write_json_value(self, pretty, w)
    }

    fn preview_json(&self, pretty: bool, max_bytes: usize) -> DocResult<(String, bool)> {
        Ok(super::export::preview_json_value(self, pretty, max_bytes))
    }

    fn borrowed_root(&self) -> Option<&Value> {
        Some(self)
    }
}
