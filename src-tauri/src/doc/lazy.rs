use std::ops::Range;

use serde_json::Value;
use sonic_rs::{FastStr, JsonType, JsonValueTrait, LazyValue, PointerNode};

use super::jobs::CancelFlag;
use super::search::{
    prepare as search_prepare, string_match_snippet, substr_contains, MatchField, SearchHit,
    SearchOptions,
};
use super::typegen::{
    merge as merge_shape, ObjectProp, PrimitiveKind, TypeShape, ARRAY_SAMPLE_CAP,
};
use super::types::{quote_preview, DocError, DocResult, NodeKind, NodeView, Path, PathSegment};

const COUNT_BUDGET_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct LazyDoc {
    source: FastStr,
    root_kind: NodeKind,
    root_index: Option<Vec<(u32, u32)>>,
}

impl LazyDoc {
    pub fn new(text: &str) -> DocResult<Self> {
        sonic_rs::from_str::<serde::de::IgnoredAny>(text)
            .map_err(|e| DocError::Parse(e.to_string()))?;
        let root_kind = root_kind_of(text);

        let source = FastStr::new(text);

        let root_index = if root_kind == NodeKind::Array {
            Some(build_root_index(&source)?)
        } else {
            None
        };

        Ok(Self {
            source,
            root_kind,
            root_index,
        })
    }

    pub fn root_kind(&self) -> NodeKind {
        self.root_kind
    }

    pub fn source(&self) -> &str {
        self.source.as_str()
    }

    pub fn root_child_count(&self) -> Option<u32> {
        if let Some(idx) = &self.root_index {
            return Some(idx.len() as u32);
        }
        if self.root_kind != NodeKind::Object {
            return None;
        }
        if self.source.len() > COUNT_BUDGET_BYTES * 16 {
            return None;
        }
        let lv = root_lv(&self.source).ok()?;
        let iter = lv.into_object_iter()?;
        Some(iter.filter_map(Result::ok).count() as u32)
    }

    pub fn slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>> {
        if path.is_root() {
            if let Some(idx) = &self.root_index {
                return Ok(slice_root_array(&self.source, idx, range));
            }
        }

        let lv = self.lookup(path)?;
        slice_lazy_value(lv, range)
    }

    pub fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        let lv = self.lookup(path)?;
        let kind = json_type_to_node_kind(lv.get_type());
        let count = maybe_count(&lv, kind);
        Ok((kind, count))
    }

    pub fn child_count_uncapped(&self, path: &Path) -> DocResult<Option<u32>> {
        // Root array's child count is already memoised at construction.
        if path.is_root() {
            if let Some(idx) = &self.root_index {
                return Ok(Some(idx.len() as u32));
            }
        }
        let lv = self.lookup(path)?;
        let kind = json_type_to_node_kind(lv.get_type());
        Ok(count_uncapped(&lv, kind))
    }

    pub fn get_value(&self, path: &Path) -> DocResult<Value> {
        if path.0.len() == 1 {
            if let Some(idx) = &self.root_index {
                if let PathSegment::Index(i) = path.0[0] {
                    let (begin, fin) = *idx
                        .get(i as usize)
                        .ok_or_else(|| DocError::InvalidPath(path.clone()))?;
                    let bytes = &self.source.as_str()[begin as usize..fin as usize];
                    return serde_json::from_str(bytes).map_err(|e| DocError::Parse(e.to_string()));
                }
            }
        }

        let lv = self.lookup(path)?;
        serde_json::from_str(lv.as_raw_str()).map_err(|e| DocError::Parse(e.to_string()))
    }

    pub fn array_field_cells(&self, path: &Path, field: &str) -> DocResult<Vec<Option<Value>>> {
        let needle = sonic_pointer(&[PathSegment::Key(field.to_string())]);
        let extract = |bytes: &str| -> Option<Value> {
            // SAFETY: `self.source` was validated as UTF-8 + well-formed JSON
            // by `LazyDoc::new`, and `bytes` is a substring of it; the
            // unchecked variant skips redundant re-validation in this hot path.
            match unsafe { sonic_rs::get_from_str_unchecked(bytes, &needle) } {
                Ok(lv) => serde_json::from_str(lv.as_raw_str()).ok(),
                Err(_) => None, // field absent / element not an object
            }
        };

        if path.is_root() {
            let Some(idx) = &self.root_index else {
                return Ok(Vec::new()); // root isn't an array
            };
            let src = self.source.as_str();
            return Ok(idx
                .iter()
                .map(|(b, e)| extract(&src[*b as usize..*e as usize]))
                .collect());
        }

        let lv = self.lookup(path)?;
        if lv.get_type() != JsonType::Array {
            return Ok(Vec::new());
        }
        let iter = lv
            .into_array_iter()
            .expect("array type confirmed by get_type");
        let mut out = Vec::new();
        for entry in iter {
            let el = entry.map_err(|e| DocError::Parse(e.to_string()))?;
            out.push(extract(el.as_raw_str()));
        }
        Ok(out)
    }

    pub fn array_field_text_lower(
        &self,
        path: &Path,
        field: &str,
    ) -> DocResult<Vec<Option<String>>> {
        let needle = sonic_pointer(&[PathSegment::Key(field.to_string())]);
        let extract = |bytes: &str| -> Option<String> {
            // SAFETY: see `array_field_cells` — same precondition holds.
            let lv = unsafe { sonic_rs::get_from_str_unchecked(bytes, &needle) }.ok()?;
            let raw = lv.as_raw_str();
            match lv.get_type() {
                JsonType::String => {
                    let s: String = serde_json::from_str(raw).ok()?;
                    Some(s.to_lowercase())
                }
                JsonType::Number | JsonType::Boolean => Some(raw.to_string()),
                _ => None, // null/object/array — not searchable as text
            }
        };

        if path.is_root() {
            let Some(idx) = &self.root_index else {
                return Ok(Vec::new());
            };
            let src = self.source.as_str();
            return Ok(idx
                .iter()
                .map(|(b, e)| extract(&src[*b as usize..*e as usize]))
                .collect());
        }

        let lv = self.lookup(path)?;
        if lv.get_type() != JsonType::Array {
            return Ok(Vec::new());
        }
        let iter = lv
            .into_array_iter()
            .expect("array type confirmed by get_type");
        let mut out = Vec::new();
        for entry in iter {
            let el = entry.map_err(|e| DocError::Parse(e.to_string()))?;
            out.push(extract(el.as_raw_str()));
        }
        Ok(out)
    }

    pub fn search(&self, opts: &SearchOptions, cancel: &CancelFlag) -> Vec<SearchHit> {
        let Some((needle, cap)) = search_prepare(opts) else {
            return Vec::new();
        };
        let mut hits = Vec::new();
        let root = match root_lv(&self.source) {
            Ok(lv) => lv,
            Err(_) => return hits,
        };
        let mut path = Path::root();
        walk_lazy(
            &root,
            &mut path,
            &needle,
            opts.case_sensitive,
            cap,
            &mut hits,
            cancel,
        );
        hits
    }

    pub fn infer_shape(&self) -> TypeShape {
        match root_lv(&self.source) {
            Ok(lv) => infer_lazy(&lv),
            Err(_) => TypeShape::Unknown,
        }
    }

    fn lookup(&self, path: &Path) -> DocResult<LazyValue<'_>> {
        if let Some(idx) = &self.root_index {
            if let Some(PathSegment::Index(i)) = path.0.first() {
                let (begin, fin) = *idx
                    .get(*i as usize)
                    .ok_or_else(|| DocError::InvalidPath(path.clone()))?;
                let bytes = &self.source.as_str()[begin as usize..fin as usize];

                if path.0.len() == 1 {
                    return unsafe { sonic_rs::get_from_str_unchecked(bytes, EMPTY_PATH) }
                        .map_err(|_| DocError::InvalidPath(path.clone()));
                }
                let pointer = sonic_pointer(&path.0[1..]);
                return unsafe { sonic_rs::get_from_str_unchecked(bytes, &pointer) }
                    .map_err(|_| DocError::InvalidPath(path.clone()));
            }
        }

        let pointer = sonic_pointer(&path.0);
        unsafe { sonic_rs::get_from_faststr_unchecked(&self.source, &pointer) }
            .map_err(|_| DocError::InvalidPath(path.clone()))
    }
}

const EMPTY_PATH: &[&str] = &[];

fn json_type_to_node_kind(t: JsonType) -> NodeKind {
    match t {
        JsonType::Object => NodeKind::Object,
        JsonType::Array => NodeKind::Array,
        JsonType::String => NodeKind::String,
        JsonType::Number => NodeKind::Number,
        JsonType::Boolean => NodeKind::Bool,
        JsonType::Null => NodeKind::Null,
    }
}

fn root_kind_of(text: &str) -> NodeKind {
    for &b in text.as_bytes() {
        match b {
            b' ' | b'\t' | b'\n' | b'\r' => continue,
            b'{' => return NodeKind::Object,
            b'[' => return NodeKind::Array,
            b'"' => return NodeKind::String,
            b't' | b'f' => return NodeKind::Bool,
            b'n' => return NodeKind::Null,
            _ => return NodeKind::Number,
        }
    }
    NodeKind::Null
}

fn sonic_pointer(segments: &[PathSegment]) -> Vec<PointerNode> {
    segments
        .iter()
        .map(|seg| match seg {
            PathSegment::Key(k) => PointerNode::Key(FastStr::new(k)),
            PathSegment::Index(i) => PointerNode::Index(*i as usize),
        })
        .collect()
}

fn root_lv(source: &FastStr) -> DocResult<LazyValue<'_>> {
    unsafe { sonic_rs::get_from_faststr_unchecked(source, EMPTY_PATH) }
        .map_err(|e| DocError::Parse(e.to_string()))
}

fn build_root_index(source: &FastStr) -> DocResult<Vec<(u32, u32)>> {
    let bytes = source.as_str().as_bytes();
    let mut i = skip_ws(bytes, 0);

    if i >= bytes.len() || bytes[i] != b'[' {
        return Err(DocError::Parse("expected array root".into()));
    }
    i += 1;
    i = skip_ws(bytes, i);

    let mut index = Vec::new();
    if i < bytes.len() && bytes[i] == b']' {
        return Ok(index); // empty array
    }

    loop {
        let start = i;
        i = skip_value(bytes, i)?;
        index.push((start as u32, i as u32));

        i = skip_ws(bytes, i);
        if i >= bytes.len() {
            return Err(DocError::Parse("unterminated array".into()));
        }
        match bytes[i] {
            b',' => {
                i = skip_ws(bytes, i + 1);
            }
            b']' => return Ok(index),
            other => {
                return Err(DocError::Parse(format!(
                    "expected ',' or ']' at byte {}, found {:?}",
                    i, other as char
                )))
            }
        }
    }
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

fn skip_value(bytes: &[u8], i: usize) -> DocResult<usize> {
    if i >= bytes.len() {
        return Err(DocError::Parse("unexpected end of input".into()));
    }
    match bytes[i] {
        b'"' => skip_string(bytes, i),
        b'{' | b'[' => skip_balanced(bytes, i),
        b't' => check_literal(bytes, i, b"true"),
        b'f' => check_literal(bytes, i, b"false"),
        b'n' => check_literal(bytes, i, b"null"),
        b'-' | b'0'..=b'9' => Ok(skip_number(bytes, i)),
        other => Err(DocError::Parse(format!(
            "unexpected byte {:?} at {}",
            other as char, i
        ))),
    }
}

fn skip_string(bytes: &[u8], mut i: usize) -> DocResult<usize> {
    debug_assert_eq!(bytes[i], b'"');
    i += 1;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Ok(i + 1),
            b'\\' => {
                if i + 1 >= bytes.len() {
                    return Err(DocError::Parse("trailing escape".into()));
                }
                i += 2;
            }
            _ => i += 1,
        }
    }
    Err(DocError::Parse("unterminated string".into()))
}

fn skip_balanced(bytes: &[u8], i: usize) -> DocResult<usize> {
    let mut depth = 1usize;
    let mut j = i + 1;

    while j < bytes.len() {
        match bytes[j] {
            b'"' => j = skip_string(bytes, j)?,
            b'{' | b'[' => {
                depth += 1;
                j += 1;
            }
            b'}' | b']' => {
                depth -= 1;
                j += 1;
                if depth == 0 {
                    return Ok(j);
                }
            }
            _ => j += 1,
        }
    }
    Err(DocError::Parse("unbalanced object/array".into()))
}

fn check_literal(bytes: &[u8], i: usize, lit: &[u8]) -> DocResult<usize> {
    if i + lit.len() > bytes.len() || &bytes[i..i + lit.len()] != lit {
        return Err(DocError::Parse(format!(
            "expected literal {:?} at {}",
            std::str::from_utf8(lit).unwrap_or("?"),
            i
        )));
    }
    Ok(i + lit.len())
}

fn skip_number(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && matches!(bytes[i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
        i += 1;
    }
    i
}

#[allow(clippy::needless_range_loop)]
fn slice_root_array(source: &FastStr, index: &[(u32, u32)], range: Range<u32>) -> Vec<NodeView> {
    let start = range.start as usize;
    let end = (range.end as usize).min(index.len());
    if start >= end {
        return Vec::new();
    }

    let source_str = source.as_str();
    let mut out = Vec::with_capacity(end - start);
    for i in start..end {
        let (begin, fin) = index[i];
        let bytes = &source_str[begin as usize..fin as usize];
        let lv = unsafe { sonic_rs::get_from_str_unchecked(bytes, EMPTY_PATH) }
            .expect("element bytes must be valid JSON (validated at open)");
        out.push(node_view(PathSegment::Index(i as u32), &lv));
    }
    out
}

fn slice_lazy_value(lv: LazyValue<'_>, range: Range<u32>) -> DocResult<Vec<NodeView>> {
    let start = range.start as usize;
    let end = range.end as usize;
    if end <= start {
        return Ok(Vec::new());
    }

    let raw = lv.as_raw_str();
    match lv.get_type() {
        JsonType::Object => slice_object_raw(raw, start, end),
        JsonType::Array => slice_array_raw(raw, start, end),
        _ => Ok(Vec::new()),
    }
}

fn slice_object_raw(raw: &str, start: usize, end: usize) -> DocResult<Vec<NodeView>> {
    let bytes = raw.as_bytes();
    let mut i = skip_ws(bytes, 0);
    if i >= bytes.len() || bytes[i] != b'{' {
        return Err(DocError::Parse("expected object".into()));
    }
    i = skip_ws(bytes, i + 1);
    let mut out = Vec::new();
    if i < bytes.len() && bytes[i] == b'}' {
        return Ok(out); // empty object
    }

    let mut idx = 0usize;
    loop {
        if i >= bytes.len() || bytes[i] != b'"' {
            return Err(DocError::Parse("expected object key".into()));
        }
        let key_start = i;
        i = skip_string(bytes, i)?;
        let key_end = i;
        i = skip_ws(bytes, i);
        if i >= bytes.len() || bytes[i] != b':' {
            return Err(DocError::Parse("expected ':' after object key".into()));
        }
        i = skip_ws(bytes, i + 1);
        let val_start = i;
        i = skip_value(bytes, i)?;
        let val_end = i;

        if idx >= start {
            let key: String = serde_json::from_str(&raw[key_start..key_end])
                .map_err(|e| DocError::Parse(e.to_string()))?;
            let lv =
                unsafe { sonic_rs::get_from_str_unchecked(&raw[val_start..val_end], EMPTY_PATH) }
                    .map_err(|e| DocError::Parse(e.to_string()))?;
            out.push(node_view(PathSegment::Key(key), &lv));
        }
        idx += 1;
        if idx >= end {
            return Ok(out);
        }

        i = skip_ws(bytes, i);
        match bytes.get(i) {
            Some(b',') => i = skip_ws(bytes, i + 1),
            Some(b'}') => return Ok(out),
            _ => return Err(DocError::Parse("expected ',' or '}' in object".into())),
        }
    }
}

fn slice_array_raw(raw: &str, start: usize, end: usize) -> DocResult<Vec<NodeView>> {
    let bytes = raw.as_bytes();
    let mut i = skip_ws(bytes, 0);
    if i >= bytes.len() || bytes[i] != b'[' {
        return Err(DocError::Parse("expected array".into()));
    }
    i = skip_ws(bytes, i + 1);
    let mut out = Vec::new();
    if i < bytes.len() && bytes[i] == b']' {
        return Ok(out); // empty array
    }

    let mut idx = 0usize;
    loop {
        let val_start = i;
        i = skip_value(bytes, i)?;
        let val_end = i;

        if idx >= start {
            let lv =
                unsafe { sonic_rs::get_from_str_unchecked(&raw[val_start..val_end], EMPTY_PATH) }
                    .map_err(|e| DocError::Parse(e.to_string()))?;
            out.push(node_view(PathSegment::Index(idx as u32), &lv));
        }
        idx += 1;
        if idx >= end {
            return Ok(out);
        }

        i = skip_ws(bytes, i);
        match bytes.get(i) {
            Some(b',') => i = skip_ws(bytes, i + 1),
            Some(b']') => return Ok(out),
            _ => return Err(DocError::Parse("expected ',' or ']' in array".into())),
        }
    }
}

fn walk_lazy(
    lv: &LazyValue<'_>,
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
    match lv.get_type() {
        JsonType::Object => {
            let Some(iter) = lv.clone().into_object_iter() else {
                return;
            };
            for entry in iter {
                if hits.len() >= cap {
                    return;
                }
                let Ok((key, child)) = entry else { return };
                let key = key.into_owned();
                if substr_contains(&key, needle, case_sensitive) {
                    path.push(PathSegment::Key(key.clone()));
                    hits.push(SearchHit {
                        path: path.clone(),
                        kind: json_type_to_node_kind(child.get_type()),
                        match_field: MatchField::Key,
                        snippet: format!("{}: {}", key, preview_lazy(&child)),
                    });
                    path.0.pop();
                    if hits.len() >= cap {
                        return;
                    }
                }
                path.push(PathSegment::Key(key));
                walk_lazy(&child, path, needle, case_sensitive, cap, hits, cancel);
                path.0.pop();
            }
        }
        JsonType::Array => {
            let Some(iter) = lv.clone().into_array_iter() else {
                return;
            };
            for (i, entry) in iter.enumerate() {
                if hits.len() >= cap {
                    return;
                }
                let Ok(child) = entry else { return };
                path.push(PathSegment::Index(i as u32));
                walk_lazy(&child, path, needle, case_sensitive, cap, hits, cancel);
                path.0.pop();
            }
        }
        JsonType::String => {
            if let Some(s) = lv.as_str() {
                if let Some(snippet) = string_match_snippet(s, needle, case_sensitive) {
                    hits.push(SearchHit {
                        path: path.clone(),
                        kind: NodeKind::String,
                        match_field: MatchField::Value,
                        snippet,
                    });
                }
            }
        }
        _ => {}
    }
}

fn infer_lazy(lv: &LazyValue<'_>) -> TypeShape {
    match lv.get_type() {
        JsonType::Null => TypeShape::Primitive(PrimitiveKind::Null),
        JsonType::Boolean => TypeShape::Primitive(PrimitiveKind::Bool),
        JsonType::Number => {
            let raw = lv.as_raw_str();
            if raw.parse::<i64>().is_ok() || raw.parse::<u64>().is_ok() {
                TypeShape::Primitive(PrimitiveKind::Integer)
            } else {
                TypeShape::Primitive(PrimitiveKind::Float)
            }
        }
        JsonType::String => TypeShape::Primitive(PrimitiveKind::String),
        JsonType::Array => {
            let Some(iter) = lv.clone().into_array_iter() else {
                return TypeShape::Array(Box::new(TypeShape::Primitive(PrimitiveKind::Any)));
            };
            let mut acc: Option<TypeShape> = None;
            for entry in iter.take(ARRAY_SAMPLE_CAP) {
                let Ok(child) = entry else { break };
                let s = infer_lazy(&child);
                acc = Some(match acc {
                    None => s,
                    Some(a) => merge_shape(a, s),
                });
            }
            match acc {
                None => TypeShape::Array(Box::new(TypeShape::Primitive(PrimitiveKind::Any))),
                Some(a) => TypeShape::Array(Box::new(a)),
            }
        }
        JsonType::Object => {
            let mut props = std::collections::BTreeMap::new();
            if let Some(iter) = lv.clone().into_object_iter() {
                for entry in iter {
                    let Ok((key, child)) = entry else { break };
                    props.insert(
                        key.into_owned(),
                        ObjectProp {
                            shape: infer_lazy(&child),
                            optional: false,
                        },
                    );
                }
            }
            TypeShape::Object(props)
        }
    }
}

fn preview_lazy(lv: &LazyValue<'_>) -> String {
    const CAP: usize = 60;
    match lv.get_type() {
        JsonType::Null => "null".into(),
        JsonType::Boolean => lv.as_bool().unwrap_or(false).to_string(),
        JsonType::Number => lv.as_raw_str().to_string(),
        JsonType::String => {
            let s = lv.as_str().unwrap_or("");
            if s.chars().count() > CAP {
                let body: String = s.chars().take(CAP).collect();
                format!("\"{body}\u{2026}\"")
            } else {
                format!("\"{s}\"")
            }
        }
        JsonType::Object => match maybe_count(lv, NodeKind::Object) {
            Some(n) => format!("{{{n} keys}}"),
            None => "{\u{2026}}".into(),
        },
        JsonType::Array => match maybe_count(lv, NodeKind::Array) {
            Some(n) => format!("[{n} items]"),
            None => "[\u{2026}]".into(),
        },
    }
}

fn node_view(key: PathSegment, lv: &LazyValue<'_>) -> NodeView {
    let kind = json_type_to_node_kind(lv.get_type());
    let child_count = maybe_count(lv, kind);
    let span = lv.as_raw_str().len();
    NodeView {
        key,
        kind,
        preview: preview(lv, kind, child_count),
        child_count,
        size_hint: span.min(u32::MAX as usize) as u32,
    }
}

fn maybe_count(lv: &LazyValue<'_>, kind: NodeKind) -> Option<u32> {
    if !matches!(kind, NodeKind::Object | NodeKind::Array) {
        return None;
    }
    if lv.as_raw_str().len() > COUNT_BUDGET_BYTES {
        return None;
    }
    count_uncapped(lv, kind)
}

fn count_uncapped(lv: &LazyValue<'_>, kind: NodeKind) -> Option<u32> {
    let cloned = lv.clone();
    match kind {
        NodeKind::Object => cloned
            .into_object_iter()
            .map(|it| it.filter_map(Result::ok).count() as u32),
        NodeKind::Array => cloned
            .into_array_iter()
            .map(|it| it.filter_map(Result::ok).count() as u32),
        _ => None,
    }
}

fn preview(lv: &LazyValue<'_>, kind: NodeKind, child_count: Option<u32>) -> String {
    match kind {
        NodeKind::Null => "null".into(),
        NodeKind::Bool => lv.as_bool().unwrap_or(false).to_string(),
        NodeKind::Number => lv.as_raw_str().to_string(),
        NodeKind::String => match lv.as_str() {
            Some(s) => quote_preview(s),
            None => String::new(),
        },
        NodeKind::Array => match child_count {
            Some(0) => "[]".into(),
            Some(n) => format!("[{n} items]"),
            None => "[\u{2026}]".into(),
        },
        NodeKind::Object => match child_count {
            Some(0) => "{}".into(),
            Some(n) => format!("{{{n} keys}}"),
            None => "{\u{2026}}".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(s: &str) -> LazyDoc {
        LazyDoc::new(s).expect("valid JSON in test")
    }

    #[test]
    fn root_kind_read_from_first_byte_with_leading_whitespace() {
        assert_eq!(root_kind_of("  \n\t{\"a\":1}"), NodeKind::Object);
        assert_eq!(root_kind_of("\n[1,2,3]"), NodeKind::Array);
        assert_eq!(root_kind_of("\"hi\""), NodeKind::String);
        assert_eq!(root_kind_of("  -12.5"), NodeKind::Number);
        assert_eq!(root_kind_of("true"), NodeKind::Bool);
        assert_eq!(root_kind_of("false"), NodeKind::Bool);
        assert_eq!(root_kind_of("null"), NodeKind::Null);
    }

    #[test]
    fn new_detects_root_kind_matching_json_type() {
        assert_eq!(doc(r#"{"a":1}"#).root_kind(), NodeKind::Object);
        assert_eq!(doc("[1,2,3]").root_kind(), NodeKind::Array);
        assert_eq!(doc("42").root_kind(), NodeKind::Number);
        assert_eq!(doc("true").root_kind(), NodeKind::Bool);
        assert_eq!(doc("null").root_kind(), NodeKind::Null);
    }

    #[test]
    #[ignore = "perf probe; run with --ignored"]
    fn perf_slice_object_past_huge_child() {
        use std::fmt::Write;
        use std::time::Instant;
        let mut s = String::with_capacity(40_000_000);
        s.push_str("{\"head\":\"x\",\"big\":[0");
        for i in 1..4_000_000u32 {
            s.push(',');
            write!(s, "{i}").unwrap();
        }
        s.push_str("],\"tail\":\"y\"}");
        let mb = s.len() / 1_000_000;
        let d = doc(&s);
        let t = Instant::now();
        let out = d.slice(&Path::root(), 0..50).unwrap();
        let dt = t.elapsed();
        eprintln!(
            "[perf] slice {mb}MB object -> {} children in {dt:?}",
            out.len()
        );
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn slice_object_yields_keys_in_source_order() {
        let d = doc(r#"{"zeta": 1, "alpha": 2, "mu": 3}"#);
        let out = d.slice(&Path::root(), 0..10).unwrap();
        let keys: Vec<_> = out
            .iter()
            .filter_map(|nv| match &nv.key {
                PathSegment::Key(k) => Some(k.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(keys, vec!["zeta", "alpha", "mu"]);
    }

    #[test]
    fn slice_array_indexes_match_positions() {
        let d = doc(r#"["a", "b", "c", "d"]"#);
        let out = d.slice(&Path::root(), 1..3).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].key, PathSegment::Index(1));
        assert_eq!(out[1].key, PathSegment::Index(2));
    }

    #[test]
    fn slice_clamps_overrun_range() {
        let d = doc(r#"[1, 2, 3]"#);
        let out = d.slice(&Path::root(), 1..100).unwrap();
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn slice_on_primitive_is_empty() {
        let d = doc(r#"42"#);
        let out = d.slice(&Path::root(), 0..10).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn invalid_path_returns_error() {
        let d = doc(r#"{"a": 1}"#);
        let bad = Path(vec![PathSegment::Key("missing".into())]);
        let err = d.slice(&bad, 0..10).unwrap_err();
        assert!(matches!(err, DocError::InvalidPath(_)));
    }

    #[test]
    fn nested_slice_walks_path_via_index() {
        let d = doc(r#"[{"id": 1, "events": [10, 20]}, {"id": 2, "events": [30]}]"#);
        let p = Path(vec![
            PathSegment::Index(0),
            PathSegment::Key("events".into()),
        ]);
        let out = d.slice(&p, 0..10).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].key, PathSegment::Index(0));
        assert_eq!(out[1].key, PathSegment::Index(1));
    }

    #[test]
    fn preview_collections_show_counts() {
        let d = doc(r#"{"arr": [1, 2, 3], "obj": {"a": 1}, "empty_arr": [], "empty_obj": {}}"#);
        let out = d.slice(&Path::root(), 0..10).unwrap();
        assert_eq!(out[0].preview, "[3 items]");
        assert_eq!(out[1].preview, "{1 keys}");
        assert_eq!(out[2].preview, "[]");
        assert_eq!(out[3].preview, "{}");
    }

    #[test]
    fn preview_truncates_long_strings() {
        let long: String = std::iter::repeat('x').take(1100).collect();
        let json = format!(r#"{{"k": "{}"}}"#, long);
        let d = doc(&json);
        let out = d.slice(&Path::root(), 0..1).unwrap();
        assert!(out[0].preview.ends_with("\u{2026}\""));
    }

    #[test]
    fn preview_preserves_big_number_token() {
        let d = doc(r#"{"id": 18446744073709551615}"#);
        let out = d.slice(&Path::root(), 0..1).unwrap();
        assert_eq!(out[0].preview, "18446744073709551615");
        assert_eq!(out[0].kind, NodeKind::Number);
    }

    #[test]
    fn count_threshold_returns_none_for_huge_collection() {
        let elem = r#""xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","#;
        let mut body = String::from("[");
        for _ in 0..2000 {
            body.push_str(elem);
        }
        body.pop();
        body.push(']');
        let json = format!(r#"{{"big": {}}}"#, body);
        assert!(json.len() > COUNT_BUDGET_BYTES);

        let d = doc(&json);
        let out = d.slice(&Path::root(), 0..1).unwrap();
        assert_eq!(out[0].kind, NodeKind::Array);
        assert!(out[0].child_count.is_none());
        assert_eq!(out[0].preview, "[\u{2026}]");
    }

    #[test]
    fn get_value_returns_subtree() {
        let d = doc(r#"{"a": {"b": 42}}"#);
        let p = Path(vec![PathSegment::Key("a".into())]);
        let v = d.get_value(&p).unwrap();
        assert_eq!(v, serde_json::json!({"b": 42}));
    }

    #[test]
    fn get_value_uses_root_index_for_array_top() {
        let d = doc(r#"[{"a": 1}, {"a": 2}, {"a": 3}]"#);
        let p = Path(vec![PathSegment::Index(1)]);
        let v = d.get_value(&p).unwrap();
        assert_eq!(v, serde_json::json!({"a": 2}));
    }

    #[test]
    fn lazy_search_matches_eager_search() {
        let json = r#"{"events":[{"msg":"hello world"},{"msg":"goodbye world"}],"worldwide":{"a":1,"b":2},"world":42}"#;
        let opts = SearchOptions {
            query: "world".into(),
            case_sensitive: false,
            max_results: 0,
        };
        let lazy_hits = doc(json).search(&opts, &CancelFlag::never());
        let v: Value = serde_json::from_str(json).unwrap();
        let eager_hits = crate::doc::search::search_in_value(&v, &opts, &CancelFlag::never());

        assert!(!lazy_hits.is_empty());
        assert_eq!(lazy_hits.len(), eager_hits.len());
        for (l, e) in lazy_hits.iter().zip(eager_hits.iter()) {
            assert_eq!(format!("{}", l.path), format!("{}", e.path));
            assert_eq!(l.match_field, e.match_field);
            assert_eq!(l.kind, e.kind);
            assert_eq!(l.snippet, e.snippet);
        }
    }

    #[test]
    fn lazy_search_respects_cap() {
        let mut body = String::from("[");
        for i in 0..50 {
            if i > 0 {
                body.push(',');
            }
            body.push_str(&format!(r#"{{"msg":"hello {}"}}"#, i));
        }
        body.push(']');
        let opts = SearchOptions {
            query: "hello".into(),
            case_sensitive: false,
            max_results: 10,
        };
        assert_eq!(doc(&body).search(&opts, &CancelFlag::never()).len(), 10);
    }

    #[test]
    fn lazy_typegen_matches_eager() {
        use crate::doc::typegen::{generate, generate_from_shape, TypegenLang};
        let json = r#"{"id":1,"name":"x","tags":["a","b"],"meta":{"k":1.5,"big":18446744073709551616},"opt":null,"rows":[{"a":1},{"a":2,"b":3}]}"#;
        let lazy = doc(json);
        let v: Value = serde_json::from_str(json).unwrap();
        for lang in [
            TypegenLang::Typescript,
            TypegenLang::Rust,
            TypegenLang::Go,
            TypegenLang::Python,
            TypegenLang::Zod,
            TypegenLang::Kotlin,
            TypegenLang::Php,
            TypegenLang::Java,
        ] {
            let eager = generate(&v, lang, "Root");
            let lazy_out = generate_from_shape(&lazy.infer_shape(), lang, "Root");
            assert_eq!(eager, lazy_out, "typegen mismatch for {:?}", lang);
        }
    }

    #[test]
    fn array_field_cells_extracts_key_column() {
        let d = doc(r#"[{"n": 3, "x": "a"}, {"n": 1}, {"x": "c"}, 42]"#);
        let cells = d.array_field_cells(&Path::root(), "n").unwrap();
        assert_eq!(
            cells,
            vec![
                Some(serde_json::json!(3)),
                Some(serde_json::json!(1)),
                None,
                None,
            ]
        );
    }

    #[test]
    fn array_field_cells_walks_nested_array() {
        let d = doc(r#"{"rows": [{"k": 2}, {"k": 1}]}"#);
        let p = Path(vec![PathSegment::Key("rows".into())]);
        let cells = d.array_field_cells(&p, "k").unwrap();
        assert_eq!(
            cells,
            vec![Some(serde_json::json!(2)), Some(serde_json::json!(1))]
        );
    }

    #[test]
    fn array_field_cells_non_array_is_empty() {
        let d = doc(r#"{"a": 1}"#);
        assert!(d.array_field_cells(&Path::root(), "a").unwrap().is_empty());
    }

    #[test]
    fn array_field_text_lower_extracts_lowercased_scalars() {
        let d =
            doc(r#"[{"n": "Hello"}, {"n": 42}, {"n": true}, {"n": null}, {"n": {"k":1}}, {}, 99]"#);
        let cells = d.array_field_text_lower(&Path::root(), "n").unwrap();
        assert_eq!(
            cells,
            vec![
                Some("hello".into()),
                Some("42".into()),
                Some("true".into()),
                None,
                None,
                None,
                None,
            ]
        );
    }

    #[test]
    fn array_field_text_lower_handles_escapes() {
        let d = doc(r#"[{"n": "Hello\nWorld"}, {"n": "Aé"}]"#);
        let cells = d.array_field_text_lower(&Path::root(), "n").unwrap();
        assert_eq!(cells, vec![Some("hello\nworld".into()), Some("aé".into())]);
    }

    #[test]
    fn root_kind_and_count_for_object() {
        let d = doc(r#"{"a": 1, "b": 2}"#);
        assert_eq!(d.root_kind(), NodeKind::Object);
        assert_eq!(d.root_child_count(), Some(2));
    }

    #[test]
    fn root_kind_and_count_for_array_via_index() {
        let d = doc(r#"[10, 20, 30, 40, 50]"#);
        assert_eq!(d.root_kind(), NodeKind::Array);
        assert_eq!(d.root_child_count(), Some(5));
    }
}
