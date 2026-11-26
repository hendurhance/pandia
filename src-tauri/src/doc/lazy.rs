use std::borrow::Cow;
use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use serde_json::Value;
use sonic_rs::{
    ArrayJsonIter, FastStr, JsonType, JsonValueTrait, LazyValue, ObjectJsonIter, PointerNode,
};

use super::cell::Cell;
use super::jobs::CancelFlag;
use super::mapped::MappedText;
use super::progress::{OpenPhase, Reporter, TICK_BYTES};
use super::scan::{scan, Rejected, Scanned};
use super::search::{match_snippet, prepare_matcher, MatchField, SearchHit, SearchOptions};
use super::tier::EDIT_SIZE_LIMIT;
use super::typegen::{
    merge as merge_shape, ObjectProp, PrimitiveKind, TypeShape, ARRAY_SAMPLE_CAP,
};
use super::types::{
    quote_preview, BigFileProblem, DocError, DocResult, NodeKind, NodeView, Path, PathSegment,
};

const COUNT_BUDGET_BYTES: usize = 64 * 1024;
pub(super) const INDEX_STRIDE: usize = 64;
const PROGRESS_MIN_STEP: usize = 1024 * 1024;

#[derive(Debug)]
enum Source {
    Owned(FastStr),
    Mapped(Arc<MappedText>),
}

impl Source {
    fn as_str(&self) -> &str {
        match self {
            Source::Owned(text) => text.as_str(),
            Source::Mapped(text) => text.as_str(),
        }
    }
}

#[derive(Debug)]
struct ArrayIndex {
    len: u32,
    checkpoints: Vec<u64>,
}

impl ArrayIndex {
    fn build(bytes: &[u8], start: usize) -> DocResult<Self> {
        let mut i = skip_ws(bytes, start);
        if i >= bytes.len() || bytes[i] != b'[' {
            return Err(DocError::Parse("expected array".into()));
        }
        i = skip_ws(bytes, i + 1);

        let mut index = Self {
            len: 0,
            checkpoints: Vec::new(),
        };
        if i < bytes.len() && bytes[i] == b']' {
            return Ok(index);
        }

        loop {
            if (index.len as usize).is_multiple_of(INDEX_STRIDE) {
                index.checkpoints.push(i as u64);
            }
            i = skip_value(bytes, i)?;
            index.len = index
                .len
                .checked_add(1)
                .ok_or(DocError::TooManyItems { limit: u32::MAX })?;

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

    fn len(&self) -> u32 {
        self.len
    }

    fn elements<'a>(&self, bytes: &'a [u8], range: Range<u32>) -> Elements<'a> {
        let end = range.end.min(self.len);
        let start = range.start.min(end);
        let k = start as usize / INDEX_STRIDE;
        let mut elements = Elements {
            bytes,
            next: self.checkpoints.get(k).map_or(0, |&at| at as usize),
            left: end - (k * INDEX_STRIDE) as u32,
        };
        for _ in 0..start as usize % INDEX_STRIDE {
            elements.next();
        }
        elements
    }

    fn element(&self, bytes: &[u8], i: u32) -> Option<Range<usize>> {
        self.elements(bytes, i..i.saturating_add(1)).next()
    }

    fn rows<'a>(&self, src: &'a str) -> impl Iterator<Item = &'a str> {
        self.elements(src.as_bytes(), 0..self.len)
            .map(move |span| &src[span])
    }
}

struct Elements<'a> {
    bytes: &'a [u8],
    next: usize,
    left: u32,
}

impl Iterator for Elements<'_> {
    type Item = Range<usize>;

    fn next(&mut self) -> Option<Range<usize>> {
        if self.left == 0 {
            return None;
        }
        self.left -= 1;
        let start = self.next;
        let end = skip_value(self.bytes, start).expect("validated JSON");
        self.next = skip_ws(self.bytes, skip_ws(self.bytes, end) + 1);
        Some(start..end)
    }
}

type ElementIndex = Arc<ArrayIndex>;

#[derive(Debug)]
pub struct LazyDoc {
    source: Source,
    root_kind: NodeKind,
    root_index: Option<ElementIndex>,
    nested_index: parking_lot::Mutex<HashMap<Path, ElementIndex>>,
}

impl LazyDoc {
    #[cfg(test)]
    pub fn new(text: FastStr) -> DocResult<Self> {
        Self::new_reporting(text, Reporter::NONE)
    }

    pub fn new_reporting(text: FastStr, progress: Reporter) -> DocResult<Self> {
        let scanned = scan(text.as_bytes(), &mut |_| true, progress);
        Self::open(Source::Owned(text), scanned, progress)
    }

    pub fn mapped(
        text: Arc<MappedText>,
        scanned: Result<Scanned, Rejected>,
        progress: Reporter,
    ) -> DocResult<Self> {
        Self::open(Source::Mapped(text), scanned, progress)
    }

    #[cfg(test)]
    pub fn mapped_for_test(text: Arc<MappedText>) -> DocResult<Self> {
        let scanned = scan(text.as_str().as_bytes(), &mut |_| true, Reporter::NONE);
        Self::mapped(text, scanned, Reporter::NONE)
    }

    fn open(
        source: Source,
        scanned: Result<Scanned, Rejected>,
        progress: Reporter,
    ) -> DocResult<Self> {
        let Ok(scanned) = scanned else {
            return Self::open_slow(source, progress);
        };
        let text = source.as_str();
        if let (Source::Mapped(mapped), false) = (&source, scanned.repeated_keys.is_empty()) {
            return Err(DocError::BigFile(BigFileProblem::RepeatedKeys {
                file: mapped.name(),
            }));
        }
        if scanned.surrogate_escape {
            parse_json::<Decoded>(text)?;
        }
        let root_kind = root_kind_of(text);
        let (source, root_index) = if scanned.repeated_keys.is_empty() {
            let index = scanned.root_items.map(|items| {
                Arc::new(ArrayIndex {
                    len: items.len,
                    checkpoints: items.checkpoints,
                })
            });
            (source, index)
        } else {
            Self::dedupe(source, &scanned.repeated_keys, root_kind)?
        };
        Ok(Self {
            source,
            root_kind,
            root_index,
            nested_index: parking_lot::Mutex::new(HashMap::new()),
        })
    }

    // Collapse repeated keys the way serde_json reads them (first position,
    // last value) so every lazy read agrees with the eager backend.
    fn dedupe(
        source: Source,
        repeated_keys: &[usize],
        root_kind: NodeKind,
    ) -> DocResult<(Source, Option<Arc<ArrayIndex>>)> {
        let text = source.as_str();
        let start = skip_ws(text.as_bytes(), 0);
        let end = skip_value(text.as_bytes(), start)?;
        let mut deduped = String::with_capacity(text.len());
        write_deduped(text, start..end, repeated_keys, &mut deduped);
        let source = Source::Owned(FastStr::from_string(deduped));
        let index = match root_kind {
            NodeKind::Array => Some(Arc::new(ArrayIndex::build(source.as_str().as_bytes(), 0)?)),
            _ => None,
        };
        Ok((source, index))
    }

    fn open_slow(source: Source, progress: Reporter) -> DocResult<Self> {
        let text = source.as_str();
        let root_kind = root_kind_of(text);
        let repeated_keys = prescan_reporting(text, progress)?;
        if let (Source::Mapped(mapped), false) = (&source, repeated_keys.is_empty()) {
            return Err(DocError::BigFile(BigFileProblem::RepeatedKeys {
                file: mapped.name(),
            }));
        }
        let index_early = root_kind == NodeKind::Array && repeated_keys.is_empty();
        let (validated, surrogate, early_index) = std::thread::scope(|scope| {
            let surrogate = scope.spawn(|| has_surrogate_escape(text));
            let index = index_early.then(|| scope.spawn(|| ArrayIndex::build(text.as_bytes(), 0)));
            (
                validate_json(text),
                join_scoped(surrogate),
                index.map(join_scoped),
            )
        });
        validated?;
        if surrogate {
            parse_json::<Decoded>(text)?;
        }
        let (source, root_index) = if repeated_keys.is_empty() {
            (source, early_index.transpose()?.map(Arc::new))
        } else {
            Self::dedupe(source, &repeated_keys, root_kind)?
        };
        Ok(Self {
            source,
            root_kind,
            root_index,
            nested_index: parking_lot::Mutex::new(HashMap::new()),
        })
    }

    pub fn root_kind(&self) -> NodeKind {
        self.root_kind
    }

    pub fn source(&self) -> &str {
        self.source.as_str()
    }

    pub fn is_mapped(&self) -> bool {
        matches!(self.source, Source::Mapped(_))
    }

    pub fn check_unchanged(&self) -> DocResult<()> {
        match &self.source {
            Source::Mapped(text) => text.check_unchanged(),
            Source::Owned(_) => Ok(()),
        }
    }

    pub fn root_child_count(&self) -> Option<u32> {
        if let Some(idx) = &self.root_index {
            return Some(idx.len());
        }
        if self.root_kind != NodeKind::Object {
            return None;
        }
        if self.source().len() > COUNT_BUDGET_BYTES * 16 {
            return None;
        }
        let lv = root_lv(self.source()).ok()?;
        let iter = lv.into_object_iter()?;
        Some(iter.filter_map(Result::ok).count() as u32)
    }

    pub fn slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>> {
        if let Some(index) = self.cached_index(path) {
            return Ok(slice_indexed_array(self.source(), &index, range));
        }
        if path.is_root() {
            return slice_raw(self.source(), self.root_kind, range);
        }
        let lv = self.lookup(path)?;
        if lv.get_type() == JsonType::Array {
            let index = self.index_array(path, &lv)?;
            return Ok(slice_indexed_array(self.source(), &index, range));
        }
        slice_raw(
            lv.as_raw_str(),
            json_type_to_node_kind(lv.get_type()),
            range,
        )
    }

    pub fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        if let Some(index) = self.array_index(path)? {
            return Ok((NodeKind::Array, Some(index.len())));
        }
        let lv = self.lookup(path)?;
        let kind = json_type_to_node_kind(lv.get_type());
        let count = count_uncapped(&lv, kind);
        Ok((kind, count))
    }

    pub fn child_count_uncapped(&self, path: &Path) -> DocResult<Option<u32>> {
        if let Some(index) = self.array_index(path)? {
            return Ok(Some(index.len()));
        }
        let lv = self.lookup(path)?;
        let kind = json_type_to_node_kind(lv.get_type());
        Ok(count_uncapped(&lv, kind))
    }

    pub fn get_value(&self, path: &Path) -> DocResult<Value> {
        if let Some((PathSegment::Index(i), parent)) = path.0.split_last() {
            if let Ok(Some(index)) = self.array_index(&Path(parent.to_vec())) {
                let src = self.source();
                let span = index
                    .element(src.as_bytes(), *i)
                    .ok_or_else(|| DocError::InvalidPath(path.clone()))?;
                return parse_within_limit(path, &src[span]);
            }
        }

        let lv = self.lookup(path)?;
        parse_within_limit(path, lv.as_raw_str())
    }

    pub fn array_field_cells(&self, path: &Path, field: &str) -> DocResult<Vec<Option<Value>>> {
        let needle = sonic_pointer(&[PathSegment::Key(field.to_string())]);
        let extract = |bytes: &str| -> Option<Value> {
            // SAFETY: `self.source` was validated as UTF-8 + well-formed JSON
            // by `LazyDoc::new`, and `bytes` is a substring of it; the
            // unchecked variant skips redundant re-validation in this hot path.
            match unsafe { sonic_rs::get_from_str_unchecked(bytes, &needle) } {
                Ok(lv) => parse_json(lv.as_raw_str()).ok(),
                Err(_) => None, // field absent / element not an object
            }
        };

        let Some(index) = self.array_index(path)? else {
            return Ok(Vec::new());
        };
        Ok(index.rows(self.source()).map(extract).collect())
    }

    pub fn array_field_keys(&self, path: &Path, field: &str) -> DocResult<Vec<Cell<'_>>> {
        let needle = sonic_pointer(&[PathSegment::Key(field.to_string())]);
        let Some(index) = self.array_index(path)? else {
            return Ok(Vec::new());
        };
        let src = self.source();
        let mut out = Vec::with_capacity(index.len() as usize);
        for element in index.rows(src) {
            out.push(
                match unsafe { sonic_rs::get_from_str_unchecked(element, &needle) } {
                    Ok(lv) => lazy_cell(src, &lv)?,
                    Err(_) => Cell::Null,
                },
            );
        }
        Ok(out)
    }

    pub fn array_field_text(&self, path: &Path, field: &str) -> DocResult<Vec<Option<String>>> {
        let needle = sonic_pointer(&[PathSegment::Key(field.to_string())]);
        let extract = |bytes: &str| -> Option<String> {
            // SAFETY: see `array_field_cells` — same precondition holds.
            let lv = unsafe { sonic_rs::get_from_str_unchecked(bytes, &needle) }.ok()?;
            let raw = lv.as_raw_str();
            match lv.get_type() {
                JsonType::String => serde_json::from_str(raw).ok(),
                JsonType::Number | JsonType::Boolean => Some(raw.to_string()),
                _ => None, // null/object/array — not searchable as text
            }
        };

        let Some(index) = self.array_index(path)? else {
            return Ok(Vec::new());
        };
        Ok(index.rows(self.source()).map(extract).collect())
    }

    pub fn search(
        &self,
        opts: &SearchOptions,
        cancel: &CancelFlag,
        report: &mut dyn FnMut(&[SearchHit], u64),
    ) -> Vec<SearchHit> {
        let Some((matcher, cap)) = prepare_matcher(opts) else {
            return Vec::new();
        };
        let mut hits = Vec::new();
        let src = self.source();
        let mut walk = Walk {
            matcher: &matcher,
            cap,
            cancel,
            progress: Progress::new(src, report),
        };
        let mut path = Path::root();
        match self.root_kind {
            NodeKind::Object => {
                let entries = unsafe { sonic_rs::to_object_iter_unchecked(src) };
                walk.object(entries, &mut path, &mut hits);
            }
            NodeKind::Array => {
                let items = unsafe { sonic_rs::to_array_iter_unchecked(src) };
                walk.array(items, &mut path, &mut hits);
            }
            _ => {
                if let Ok(root) = root_lv(src) {
                    walk.value(&root, &mut path, &mut hits);
                }
            }
        }
        hits
    }

    pub fn infer_shape(&self) -> TypeShape {
        match root_lv(self.source()) {
            Ok(lv) => infer_lazy(&lv),
            Err(_) => TypeShape::Unknown,
        }
    }

    // before it. A nested array is indexed on first use and kept: the source never changes.
    fn array_index(&self, path: &Path) -> DocResult<Option<ElementIndex>> {
        if path.is_root() {
            return Ok(self.root_index.clone());
        }
        if let Some(index) = self.cached_index(path) {
            return Ok(Some(index));
        }
        let lv = self.lookup(path)?;
        if lv.get_type() != JsonType::Array {
            return Ok(None);
        }
        self.index_array(path, &lv).map(Some)
    }

    fn cached_index(&self, path: &Path) -> Option<ElementIndex> {
        if path.is_root() {
            return self.root_index.clone();
        }
        self.nested_index.lock().get(path).cloned()
    }

    fn index_array(&self, path: &Path, lv: &LazyValue<'_>) -> DocResult<ElementIndex> {
        // `lookup` returns a slice of the source, so its distance from the start is its offset.
        let start = lv.as_raw_str().as_ptr() as usize - self.source().as_ptr() as usize;
        let index = Arc::new(ArrayIndex::build(self.source().as_bytes(), start)?);
        self.nested_index
            .lock()
            .insert(path.clone(), Arc::clone(&index));
        Ok(index)
    }

    fn indexed_ancestor(&self, path: &Path) -> Option<(usize, ElementIndex)> {
        let cache = self.nested_index.lock();
        for (k, seg) in path.0.iter().enumerate().rev() {
            if !matches!(seg, PathSegment::Index(_)) {
                continue;
            }
            let index = if k == 0 {
                self.root_index.clone()
            } else {
                cache.get(&Path(path.0[..k].to_vec())).cloned()
            };
            if let Some(index) = index {
                return Some((k, index));
            }
        }
        None
    }

    fn lookup(&self, path: &Path) -> DocResult<LazyValue<'_>> {
        let invalid = || DocError::InvalidPath(path.clone());
        let src = self.source();
        let Some((k, index)) = self.indexed_ancestor(path) else {
            let pointer = sonic_pointer(&path.0);
            return unsafe { sonic_rs::get_from_str_unchecked(src, &pointer) }
                .map_err(|_| invalid());
        };
        let PathSegment::Index(i) = path.0[k] else {
            unreachable!("indexed_ancestor returns an index segment")
        };
        let bytes = &src[index.element(src.as_bytes(), i).ok_or_else(invalid)?];
        let rest = &path.0[k + 1..];
        if rest.is_empty() {
            return unsafe { sonic_rs::get_from_str_unchecked(bytes, EMPTY_PATH) }
                .map_err(|_| invalid());
        }
        let pointer = sonic_pointer(rest);
        unsafe { sonic_rs::get_from_str_unchecked(bytes, &pointer) }.map_err(|_| invalid())
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

fn root_lv(source: &str) -> DocResult<LazyValue<'_>> {
    unsafe { sonic_rs::get_from_str_unchecked(source, EMPTY_PATH) }
        .map_err(|e| DocError::Parse(e.to_string()))
}

// `repeated` holds the ascending offsets of objects that repeat a key; spans
// containing none of them are copied verbatim.
fn write_deduped(text: &str, span: Range<usize>, repeated: &[usize], out: &mut String) {
    let next = repeated.partition_point(|&at| at < span.start);
    if !matches!(repeated.get(next), Some(&at) if at < span.end) {
        out.push_str(&text[span]);
        return;
    }
    let bytes = text.as_bytes();
    let mut i = skip_ws(bytes, span.start + 1);
    if bytes[span.start] == b'[' {
        out.push('[');
        while bytes[i] != b']' {
            let end = skip_value(bytes, i).expect("validated JSON");
            write_deduped(text, i..end, repeated, out);
            i = skip_ws(bytes, end);
            if bytes[i] == b',' {
                out.push(',');
                i = skip_ws(bytes, i + 1);
            }
        }
        out.push(']');
        return;
    }
    let mut entries: Vec<(&str, Range<usize>)> = Vec::new();
    let mut index_of: HashMap<Cow<'_, str>, usize> = HashMap::new();
    while bytes[i] != b'}' {
        let key_end = skip_string(bytes, i).expect("validated JSON");
        let raw_key = &text[i..key_end];
        let value_start = skip_ws(bytes, skip_ws(bytes, key_end) + 1);
        let value = value_start..skip_value(bytes, value_start).expect("validated JSON");
        i = skip_ws(bytes, value.end);
        if bytes[i] == b',' {
            i = skip_ws(bytes, i + 1);
        }
        let key = key_text(raw_key);
        match index_of.get(&key) {
            Some(&n) => entries[n].1 = value,
            None => {
                index_of.insert(key, entries.len());
                entries.push((raw_key, value));
            }
        }
    }
    out.push('{');
    for (n, (raw_key, value)) in entries.into_iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        out.push_str(raw_key);
        out.push(':');
        write_deduped(text, value, repeated, out);
    }
    out.push('}');
}

pub(super) fn key_text(raw: &str) -> Cow<'_, str> {
    if raw.contains('\\') {
        serde_json::from_str(raw).map_or(Cow::Borrowed(raw), Cow::Owned)
    } else {
        Cow::Borrowed(&raw[1..raw.len() - 1])
    }
}

fn join_scoped<T>(handle: std::thread::ScopedJoinHandle<'_, T>) -> T {
    handle
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
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

pub(crate) const MAX_DEPTH: u32 = 1000;

// Iterative, so text nested too deep for the recursive parsers is refused before
// they see it. Returns the byte offsets, ascending, of objects that repeat a key.
pub(crate) fn prescan(text: &str) -> DocResult<Vec<usize>> {
    prescan_reporting(text, Reporter::NONE)
}

fn prescan_reporting(text: &str, progress: Reporter) -> DocResult<Vec<usize>> {
    let bytes = text.as_bytes();
    let mut next_tick = TICK_BYTES;
    // Per open object: its byte offset and where its keys start in `keys`; None for an array.
    let mut open: Vec<Option<(usize, usize)>> = Vec::new();
    let mut keys: Vec<Cow<'_, str>> = Vec::new();
    let mut repeated = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if i >= next_tick {
            progress.step(OpenPhase::Checking, i, bytes.len());
            next_tick = i + TICK_BYTES;
        }
        match bytes[i] {
            b'"' => {
                let Ok(end) = skip_string(bytes, i) else {
                    break;
                };
                if matches!(open.last(), Some(Some(_)))
                    && bytes.get(skip_ws(bytes, end)) == Some(&b':')
                {
                    keys.push(key_text(&text[i..end]));
                }
                i = end;
            }
            b'{' | b'[' => {
                if open.len() == MAX_DEPTH as usize {
                    return Err(DocError::TooDeep { limit: MAX_DEPTH });
                }
                open.push((bytes[i] == b'{').then_some((i, keys.len())));
                i += 1;
            }
            b'}' | b']' => {
                if let Some(Some((at, start))) = open.pop() {
                    let own = &mut keys[start..];
                    own.sort_unstable();
                    if own.windows(2).any(|w| w[0] == w[1]) {
                        repeated.push(at);
                    }
                    keys.truncate(start);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    repeated.sort_unstable();
    Ok(repeated)
}

// Use for document text instead of serde_json::from_str, whose limit of 128 levels
// would refuse documents Pandia supports.
pub(crate) fn parse_json<T: serde::de::DeserializeOwned>(text: &str) -> DocResult<T> {
    prescan(text)?;
    let mut de = serde_json::Deserializer::from_str(text);
    de.disable_recursion_limit();
    T::deserialize(&mut de)
        .and_then(|v| de.end().map(|()| v))
        .map_err(|e| DocError::Parse(e.to_string()))
}

fn validate_json(text: &str) -> DocResult<()> {
    let checked = if text.len() > u32::MAX as usize {
        let mut de = serde_json::Deserializer::from_str(text);
        de.disable_recursion_limit();
        <serde::de::IgnoredAny as serde::Deserialize>::deserialize(&mut de)
            .and_then(|_| de.end())
            .map_err(|e| e.to_string())
    } else {
        sonic_rs::from_str::<serde::de::IgnoredAny>(text)
            .map(drop)
            .map_err(|e| e.to_string())
    };
    checked.map_err(DocError::Parse)
}

fn has_surrogate_escape(text: &str) -> bool {
    let b = text.as_bytes();
    text.match_indices('\\').any(|(i, _)| {
        b.get(i + 1) == Some(&b'u')
            && matches!(b.get(i + 2), Some(b'd' | b'D'))
            && matches!(b.get(i + 3), Some(b'8'..=b'9' | b'a'..=b'f' | b'A'..=b'F'))
    })
}

struct Decoded;

impl<'de> serde::Deserialize<'de> for Decoded {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(Decoded)
    }
}

impl<'de> serde::de::Visitor<'de> for Decoded {
    type Value = Decoded;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_bool<E>(self, _: bool) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_i64<E>(self, _: i64) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_u64<E>(self, _: u64) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_f64<E>(self, _: f64) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_str<E>(self, _: &str) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_unit<E>(self) -> Result<Decoded, E> {
        Ok(Decoded)
    }

    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Decoded, A::Error> {
        while seq.next_element::<Decoded>()?.is_some() {}
        Ok(Decoded)
    }

    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Decoded, A::Error> {
        while map.next_entry::<Decoded, Decoded>()?.is_some() {}
        Ok(Decoded)
    }
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

fn slice_indexed_array(source: &str, index: &ArrayIndex, range: Range<u32>) -> Vec<NodeView> {
    (range.start..)
        .zip(index.elements(source.as_bytes(), range))
        .map(|(i, span)| {
            raw_node_view(PathSegment::Index(i), &source[span])
                .expect("element bytes must be valid JSON (validated at open)")
        })
        .collect()
}

fn slice_raw(raw: &str, kind: NodeKind, range: Range<u32>) -> DocResult<Vec<NodeView>> {
    let start = range.start as usize;
    let end = range.end as usize;
    if end <= start {
        return Ok(Vec::new());
    }
    match kind {
        NodeKind::Object => slice_object_raw(raw, start, end),
        NodeKind::Array => slice_array_raw(raw, start, end),
        _ => Ok(Vec::new()),
    }
}

fn raw_node_view(key: PathSegment, raw: &str) -> DocResult<NodeView> {
    let kind = root_kind_of(raw);
    if raw.len() > COUNT_BUDGET_BYTES && matches!(kind, NodeKind::Object | NodeKind::Array) {
        return Ok(NodeView {
            key,
            kind,
            preview: container_preview(kind, None),
            child_count: None,
        });
    }
    let lv = unsafe { sonic_rs::get_from_str_unchecked(raw, EMPTY_PATH) }
        .map_err(|e| DocError::Parse(e.to_string()))?;
    Ok(node_view(key, &lv))
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
            out.push(raw_node_view(
                PathSegment::Key(key),
                &raw[val_start..val_end],
            )?);
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
            out.push(raw_node_view(
                PathSegment::Index(idx as u32),
                &raw[val_start..val_end],
            )?);
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

struct Progress<'r> {
    base: usize,
    step: usize,
    next_at: usize,
    sent: usize,
    report: &'r mut dyn FnMut(&[SearchHit], u64),
}

impl<'r> Progress<'r> {
    fn new(src: &str, report: &'r mut dyn FnMut(&[SearchHit], u64)) -> Self {
        let step = (src.len() / 100).max(PROGRESS_MIN_STEP);
        Self {
            base: src.as_ptr() as usize,
            step,
            next_at: step,
            sent: 0,
            report,
        }
    }

    fn reached(&mut self, lv: &LazyValue<'_>, hits: &[SearchHit]) {
        let offset = lv.as_raw_str().as_ptr() as usize - self.base;
        if offset < self.next_at {
            return;
        }
        self.next_at = offset + self.step;
        (self.report)(&hits[self.sent..], offset as u64);
        self.sent = hits.len();
    }
}

struct Walk<'a, 'r> {
    matcher: &'a regex::Regex,
    cap: usize,
    cancel: &'a CancelFlag,
    progress: Progress<'r>,
}

impl<'s> Walk<'_, '_> {
    fn value(&mut self, lv: &LazyValue<'s>, path: &mut Path, hits: &mut Vec<SearchHit>) {
        if self.cancel.is_cancelled() || hits.len() >= self.cap {
            return;
        }
        match lv.get_type() {
            JsonType::Object => {
                if let Some(entries) = lv.clone().into_object_iter() {
                    self.object(entries, path, hits);
                }
            }
            JsonType::Array => {
                if let Some(items) = lv.clone().into_array_iter() {
                    self.array(items, path, hits);
                }
            }
            JsonType::String => {
                if let Some(s) = lv.as_str() {
                    if let Some(snippet) = match_snippet(s, self.matcher) {
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

    fn object(&mut self, entries: ObjectJsonIter<'s>, path: &mut Path, hits: &mut Vec<SearchHit>) {
        for entry in entries {
            if hits.len() >= self.cap {
                return;
            }
            let Ok((key, child)) = entry else { return };
            self.progress.reached(&child, hits);
            let key = key.into_owned();
            if self.matcher.is_match(&key) {
                path.push(PathSegment::Key(key.clone()));
                hits.push(SearchHit {
                    path: path.clone(),
                    kind: json_type_to_node_kind(child.get_type()),
                    match_field: MatchField::Key,
                    snippet: format!("{}: {}", key, preview_lazy(&child)),
                });
                path.0.pop();
                if hits.len() >= self.cap {
                    return;
                }
            }
            path.push(PathSegment::Key(key));
            self.value(&child, path, hits);
            path.0.pop();
        }
    }

    fn array(&mut self, items: ArrayJsonIter<'s>, path: &mut Path, hits: &mut Vec<SearchHit>) {
        for (i, item) in items.enumerate() {
            if hits.len() >= self.cap {
                return;
            }
            let Ok(child) = item else { return };
            self.progress.reached(&child, hits);
            path.push(PathSegment::Index(i as u32));
            self.value(&child, path, hits);
            path.0.pop();
        }
    }
}

fn infer_lazy(lv: &LazyValue<'_>) -> TypeShape {
    match lv.get_type() {
        JsonType::Null => TypeShape::Primitive(PrimitiveKind::Null),
        JsonType::Boolean => TypeShape::Primitive(PrimitiveKind::Bool),
        JsonType::Number => TypeShape::Primitive(super::typegen::number_kind(lv.as_raw_str())),
        JsonType::String => TypeShape::Primitive(PrimitiveKind::String),
        JsonType::Array => {
            let Some(iter) = lv.clone().into_array_iter() else {
                return TypeShape::Array(Box::new(TypeShape::Unknown));
            };
            let len = iter.count();
            let mut picked = super::typegen::sample_indices(len, ARRAY_SAMPLE_CAP).peekable();
            let mut acc: Option<TypeShape> = None;
            for (i, entry) in lv
                .clone()
                .into_array_iter()
                .into_iter()
                .flatten()
                .enumerate()
            {
                if picked.next_if_eq(&i).is_none() {
                    continue;
                }
                let Ok(child) = entry else { break };
                let s = infer_lazy(&child);
                acc = Some(match acc {
                    None => s,
                    Some(a) => merge_shape(a, s),
                });
            }
            match acc {
                None => TypeShape::Array(Box::new(TypeShape::Unknown)),
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
                            nullable: false,
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
        JsonType::Number => number_preview(lv),
        JsonType::String => {
            let s = lv.as_str().unwrap_or("");
            if s.chars().count() > CAP {
                let body: String = s.chars().take(CAP).collect();
                format!("\"{body}\u{2026}\"")
            } else {
                format!("\"{s}\"")
            }
        }
        JsonType::Object => match count_uncapped(lv, NodeKind::Object) {
            Some(n) => format!("{{{n} keys}}"),
            None => "{\u{2026}}".into(),
        },
        JsonType::Array => match count_uncapped(lv, NodeKind::Array) {
            Some(n) => format!("[{n} items]"),
            None => "[\u{2026}]".into(),
        },
    }
}

fn number_preview(lv: &LazyValue<'_>) -> String {
    let raw = lv.as_raw_str();
    serde_json::from_str::<serde_json::Number>(raw)
        .map_or_else(|_| raw.to_string(), |n| n.to_string())
}

fn parse_within_limit(path: &Path, raw: &str) -> DocResult<Value> {
    let actual = raw.len() as u64;
    if actual > EDIT_SIZE_LIMIT {
        return Err(DocError::ValueTooLarge {
            path: path.clone(),
            actual,
            limit: EDIT_SIZE_LIMIT,
        });
    }
    parse_json(raw)
}

fn lazy_cell<'a>(src: &'a str, lv: &LazyValue<'_>) -> DocResult<Cell<'a>> {
    let raw = lv.as_raw_str();
    let start = raw.as_ptr() as usize - src.as_ptr() as usize;
    let raw = &src[start..start + raw.len()];
    Ok(match lv.get_type() {
        JsonType::Null => Cell::Null,
        JsonType::Boolean => Cell::Bool(raw.starts_with('t')),
        JsonType::Number => Cell::Num(raw),
        JsonType::String if !raw.contains('\\') => Cell::Str(&raw[1..raw.len() - 1]),
        JsonType::String => Cell::OwnedStr(parse_json::<String>(raw)?.into_boxed_str()),
        kind => Cell::Raw {
            raw,
            len: count_uncapped(lv, json_type_to_node_kind(kind)).unwrap_or(0),
            object: kind == JsonType::Object,
        },
    })
}

fn node_view(key: PathSegment, lv: &LazyValue<'_>) -> NodeView {
    let kind = json_type_to_node_kind(lv.get_type());
    let child_count = maybe_count(lv, kind);
    NodeView {
        key,
        kind,
        preview: preview(lv, kind, child_count),
        child_count,
    }
}

impl super::backend::DocumentBackend for LazyDoc {
    fn root_kind_and_count(&self) -> (NodeKind, Option<u32>) {
        (self.root_kind(), self.root_child_count())
    }

    fn root_preview(&self) -> String {
        match self.lookup(&Path::root()) {
            Ok(lv) => preview(&lv, self.root_kind(), None),
            Err(_) => String::new(),
        }
    }

    fn slice(&self, path: &Path, range: std::ops::Range<u32>) -> DocResult<Vec<NodeView>> {
        LazyDoc::slice(self, path, range)
    }

    fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        LazyDoc::kind_at(self, path)
    }

    fn child_count_at(&self, path: &Path) -> DocResult<Option<u32>> {
        self.child_count_uncapped(path)
    }

    fn get_value(&self, path: &Path) -> DocResult<Value> {
        LazyDoc::get_value(self, path)
    }

    fn rows(&self, path: &Path, range: std::ops::Range<u32>) -> DocResult<Vec<Value>> {
        let Some(index) = self.array_index(path)? else {
            return Ok(Vec::new());
        };
        let src = self.source();
        (range.start..)
            .zip(index.elements(src.as_bytes(), range))
            .map(|(i, span)| {
                let mut row = path.clone();
                row.push(PathSegment::Index(i));
                parse_within_limit(&row, &src[span])
            })
            .collect()
    }

    fn column_cells(&self, path: &Path, key: &str) -> DocResult<Vec<Option<Value>>> {
        self.array_field_cells(path, key)
    }

    fn column_keys(&self, path: &Path, key: &str) -> DocResult<Vec<Cell<'_>>> {
        self.array_field_keys(path, key)
    }

    fn column_text(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>> {
        self.array_field_text(path, key)
    }

    fn for_each_row_field(
        &self,
        path: &Path,
        cancel: &CancelFlag,
        f: &mut dyn FnMut(&str, NodeKind),
    ) -> DocResult<u32> {
        let Some(index) = self.array_index(path)? else {
            return Ok(0);
        };
        for (i, element) in index.rows(self.source()).enumerate() {
            if i % 4096 == 0 && cancel.is_cancelled() {
                return Err(DocError::Cancelled);
            }

            let row = unsafe { sonic_rs::get_from_str_unchecked(element, EMPTY_PATH) };
            let Some(fields) = row.ok().and_then(|lv| lv.into_object_iter()) else {
                continue;
            };
            for (k, v) in fields.flatten() {
                f(&k, json_type_to_node_kind(v.get_type()));
            }
        }
        Ok(index.len())
    }

    fn search(
        &self,
        opts: &SearchOptions,
        cancel: &CancelFlag,
        report: &mut dyn FnMut(&[SearchHit], u64),
    ) -> Vec<SearchHit> {
        LazyDoc::search(self, opts, cancel, report)
    }

    fn generate_types(
        &self,
        lang: super::typegen::TypegenLang,
        type_name: &str,
    ) -> DocResult<String> {
        match lang {
            super::typegen::TypegenLang::JsonSchema => {
                let v = LazyDoc::get_value(self, &Path::root())?;
                Ok(super::typegen::generate(&v, lang, type_name))
            }
            _ => Ok(super::typegen::generate_from_shape(
                &self.infer_shape(),
                lang,
                type_name,
            )),
        }
    }

    fn hash_into(&self, hasher: &mut blake3::Hasher) -> Result<(), ()> {
        hasher.update(self.source().as_bytes());
        Ok(())
    }

    fn serialize_pretty(&self) -> DocResult<String> {
        Ok(self.source().to_string())
    }

    fn serialize_ndjson(&self) -> Option<String> {
        let index = self.root_index.as_deref()?;
        let src = self.source();
        let mut out = Vec::with_capacity(src.len() + index.len() as usize);
        for row in index.rows(src) {
            super::export::reformat_json(row.as_bytes(), false, &mut out).ok()?;
            out.push(b'\n');
        }
        String::from_utf8(out).ok()
    }

    fn write_json(
        &self,
        pretty: bool,
        w: &mut dyn std::io::Write,
    ) -> Result<(), super::export::ExportError> {
        super::export::write_json_source(self.source(), pretty, w)
    }

    fn preview_json(&self, pretty: bool, max_bytes: usize) -> DocResult<(String, bool)> {
        super::export::preview_json_source(self.source(), pretty, max_bytes)
            .map_err(|e| DocError::Export(e.to_string()))
    }

    fn borrowed_root(&self) -> Option<&Value> {
        None
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
        NodeKind::Number => number_preview(lv),
        NodeKind::String => match lv.as_str() {
            Some(s) => quote_preview(s),
            None => String::new(),
        },
        NodeKind::Array | NodeKind::Object => container_preview(kind, child_count),
    }
}

fn container_preview(kind: NodeKind, child_count: Option<u32>) -> String {
    match (kind, child_count) {
        (NodeKind::Array, Some(0)) => "[]".into(),
        (NodeKind::Array, Some(n)) => format!("[{n} items]"),
        (NodeKind::Array, None) => "[\u{2026}]".into(),
        (_, Some(0)) => "{}".into(),
        (_, Some(n)) => format!("{{{n} keys}}"),
        (_, None) => "{\u{2026}}".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(s: &str) -> LazyDoc {
        LazyDoc::new(FastStr::new(s)).expect("valid JSON in test")
    }

    fn assert_scan_agrees(text: &str) {
        let fast = scan(text.as_bytes(), &mut |_| true, Reporter::NONE);
        let mut de = serde_json::Deserializer::from_str(text);
        de.disable_recursion_limit();
        let to_spec = prescan(text).is_ok()
            && <serde::de::IgnoredAny as serde::Deserialize>::deserialize(&mut de)
                .and_then(|_| de.end())
                .is_ok();
        assert_eq!(fast.is_ok(), to_spec, "{text:?}: scan gave {fast:?}");
        let slow = prescan(text).and_then(|repeated| validate_json(text).map(|()| repeated));
        match (fast, slow) {
            (Ok(fast), Ok(repeated)) => {
                assert_eq!(fast.repeated_keys, repeated, "{text:?}");
                assert!(
                    !fast.surrogate_escape || has_surrogate_escape(text),
                    "{text:?}"
                );
                let index = (root_kind_of(text) == NodeKind::Array)
                    .then(|| ArrayIndex::build(text.as_bytes(), 0).unwrap());
                assert_eq!(
                    fast.root_items.map(|r| (r.len, r.checkpoints)),
                    index.map(|i| (i.len, i.checkpoints)),
                    "{text:?}"
                );
            }
            (Ok(_), Err(slow)) => panic!("{text:?}: scan accepted, separate checks gave {slow:?}"),
            (Err(_), _) => {}
        }
    }

    #[test]
    fn the_one_pass_scan_agrees_with_the_separate_checks_on_edge_cases() {
        let deep = |n: usize| format!("{}{}", "[".repeat(n), "]".repeat(n));
        for text in [
            "",
            " ",
            "0",
            "-0",
            "01",
            "1.",
            "-",
            "1e",
            "1e+",
            "1.5E-3",
            "1e400",
            "tru",
            "nulll",
            "[1,]",
            "[,1]",
            "[1 2]",
            "[1}",
            "[1]]",
            "[1] [2]",
            "{\"a\"}",
            "{\"a\":}",
            "{,}",
            "{\"a\":1]",
            "{\"a\":1,}",
            "{1:2}",
            "\"\\x\"",
            "\"\\u12G4\"",
            "\"\\u12\"",
            "\"a\u{1}\"",
            "\u{feff}[1]",
            "[\"\\ud800\"]",
            "[\"\\\\ud800\"]",
            "{\"a\":1,\"a\":2}",
            "{\"\\u0061\":1,\"a\":2}",
            "[{\"k\":1,\"k\":2},{\"k\":3}]",
            " [ ] ",
            "{ }",
            "\"unterminated",
            "[\"é\", \"😀\"]",
        ] {
            assert_scan_agrees(text);
        }
        let scan_text = |t: &str| scan(t.as_bytes(), &mut |_| true, Reporter::NONE);
        assert!(scan_text(&deep(MAX_DEPTH as usize)).is_ok());
        assert!(scan_text(&deep(MAX_DEPTH as usize + 1)).is_err());
        assert!(prescan(&deep(MAX_DEPTH as usize + 1)).is_err());
    }

    #[test]
    fn the_one_pass_scan_agrees_with_the_separate_checks_on_mutated_documents() {
        let long = (0..200)
            .map(|i| format!(r#"{{"id":{i},"tag":"t{i}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let seeds = [
            r#"[1, -2.5e+3, 0, "a\"b\\c\u00e9", true, false, null, {"k": [ ]}, {}]"#.to_string(),
            r#"{"a": {"b": [1, {"c": "d", "c": 2}]}, "a": "\ud83d\ude00", "e": -0.0E-0}"#.into(),
            r#"  "just a string"  "#.into(),
            "[[[[]]], [{}], -12.5]".into(),
            format!("[{long}]"),
        ];
        let alphabet: Vec<char> = "{}[]\",:\\ -+.eE0123456789tfnulrsa\n\t/bé\u{1}"
            .chars()
            .collect();
        let mut state = 0x9E37_79B9_7F4A_7C15_u64;
        let mut next = |below: usize| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % below as u64) as usize
        };
        for seed in &seeds {
            for _ in 0..3_000 {
                let mut chars: Vec<char> = seed.chars().collect();
                for _ in 0..=next(3) {
                    let at = next(chars.len() + 1);
                    match next(3) {
                        0 => chars.insert(at, alphabet[next(alphabet.len())]),
                        1 if at < chars.len() => {
                            chars.remove(at);
                        }
                        _ if at < chars.len() => chars[at] = alphabet[next(alphabet.len())],
                        _ => {}
                    }
                }
                assert_scan_agrees(&chars.into_iter().collect::<String>());
            }
        }
    }

    #[test]
    fn reading_a_value_over_the_size_limit_is_refused_before_it_is_built() {
        let limit = EDIT_SIZE_LIMIT as usize;
        let d = doc(&format!(
            r#"{{"small": [1, 2], "big": [{}0]}}"#,
            " ".repeat(limit)
        ));
        let big = Path(vec![PathSegment::Key("big".into())]);
        match d.get_value(&big) {
            Err(DocError::ValueTooLarge {
                path,
                actual,
                limit: l,
            }) => {
                assert_eq!((path, l), (big, EDIT_SIZE_LIMIT));
                assert!(actual > EDIT_SIZE_LIMIT);
            }
            other => panic!("expected ValueTooLarge, got {:?}", other.map(|_| ())),
        }
        let small = Path(vec![PathSegment::Key("small".into())]);
        assert_eq!(d.get_value(&small).unwrap(), serde_json::json!([1, 2]));
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
    #[ignore = "perf probe; run the release test binary with --ignored --nocapture"]
    fn perf_open_passes() {
        use std::fmt::Write;
        use std::time::Instant;
        let mut s = String::with_capacity(520_000_000);
        s.push('[');
        let mut i = 0u32;
        while s.len() < 500_000_000 {
            if i > 0 {
                s.push(',');
            }
            write!(
                s,
                r#"{{"id":{i},"name":"user {i}","tags":["a","b"],"score":{}.5}}"#,
                i % 1000
            )
            .unwrap();
            i += 1;
        }
        s.push(']');
        let mb = s.len() / 1_000_000;
        let bytes = s.clone().into_bytes();
        let t = Instant::now();
        let text = String::from_utf8(bytes).unwrap();
        let utf8 = t.elapsed();
        let t = Instant::now();
        prescan(&text).unwrap();
        let pre = t.elapsed();
        let t = Instant::now();
        sonic_rs::from_str::<serde::de::IgnoredAny>(&text).unwrap();
        let validate = t.elapsed();
        let t = Instant::now();
        has_surrogate_escape(&text);
        let surrogate = t.elapsed();
        let t = Instant::now();
        ArrayIndex::build(text.as_bytes(), 0).unwrap();
        let index = t.elapsed();
        let t = Instant::now();
        let mut h = blake3::Hasher::new();
        h.update(text.as_bytes());
        h.finalize();
        let hash = t.elapsed();
        let t = Instant::now();
        let d = super::super::document::Document::from_source(FastStr::from_string(text), None)
            .unwrap();
        let open = t.elapsed();
        drop(d);
        eprintln!("[open] {mb}MB, {i} records: utf8 {utf8:?}, prescan {pre:?}, validate {validate:?}, surrogate {surrogate:?}, index {index:?}, hash {hash:?} | Document::from_source total {open:?}");
    }

    #[test]
    #[ignore = "perf probe; run with --ignored"]
    fn perf_page_deep_into_a_nested_array() {
        use std::fmt::Write;
        use std::time::Instant;
        const N: u32 = 1_000_000;
        let mut s = String::with_capacity(40_000_000);
        s.push_str("{\"data\":[");
        for i in 0..N {
            if i > 0 {
                s.push(',');
            }
            write!(s, "{{\"id\":{i},\"name\":\"n{i}\"}}").unwrap();
        }
        s.push_str("]}");
        let mb = s.len() / 1_000_000;
        let d = doc(&s);
        let data = Path(vec![PathSegment::Key("data".into())]);
        let t = Instant::now();
        d.slice(&data, 0..200).unwrap();
        let first = t.elapsed();
        let t = Instant::now();
        assert_eq!(d.child_count_uncapped(&data).unwrap(), Some(N));
        let count = t.elapsed();
        let t = Instant::now();
        let old_count = count_uncapped(&d.lookup(&data).unwrap(), NodeKind::Array);
        let full_scan_count = t.elapsed();
        assert_eq!(old_count, Some(N));

        let t = Instant::now();
        for page in 0..20 {
            let from = N - 200 * (page + 1);
            assert_eq!(d.slice(&data, from..from + 200).unwrap().len(), 200);
        }
        let pages = t.elapsed();

        let row = Path(vec![
            PathSegment::Key("data".into()),
            PathSegment::Index(N - 5),
        ]);
        let t = Instant::now();
        for _ in 0..20 {
            assert_eq!(d.slice(&row, 0..10).unwrap().len(), 2);
        }
        let rows = t.elapsed();
        eprintln!("[perf] {mb}MB nested array: first page {first:?}, count {count:?} (a full-scan count takes {full_scan_count:?}), 20 pages near the end {pages:?}, 20 row expands near the end {rows:?}");
    }

    #[test]
    fn nested_array_pages_and_rows_read_the_right_elements() {
        let d = doc(
            r#"{"meta": {"n": 5}, "data": [{"id": 0}, {"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]}"#,
        );
        let data = Path(vec![PathSegment::Key("data".into())]);
        let page = d.slice(&data, 2..4).unwrap();
        assert_eq!(
            page.iter().map(|n| n.key.clone()).collect::<Vec<_>>(),
            [PathSegment::Index(2), PathSegment::Index(3)]
        );
        assert_eq!(d.slice(&data, 4..99).unwrap().len(), 1);
        assert!(d.slice(&data, 7..9).unwrap().is_empty());
        assert_eq!(d.child_count_uncapped(&data).unwrap(), Some(5));

        let row = Path(vec![PathSegment::Key("data".into()), PathSegment::Index(3)]);
        let fields = d.slice(&row, 0..10).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].preview, "3");
        let id = Path(vec![
            PathSegment::Key("data".into()),
            PathSegment::Index(3),
            PathSegment::Key("id".into()),
        ]);
        assert_eq!(d.get_value(&id).unwrap(), serde_json::json!(3));
        let past_end = Path(vec![PathSegment::Key("data".into()), PathSegment::Index(9)]);
        assert!(matches!(
            d.slice(&past_end, 0..1),
            Err(DocError::InvalidPath(_))
        ));
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
            max_results: None,
        };
        let lazy_hits = doc(json).search(&opts, &CancelFlag::never(), &mut |_, _| {});
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
            max_results: Some(10),
        };
        assert_eq!(
            doc(&body)
                .search(&opts, &CancelFlag::never(), &mut |_, _| {})
                .len(),
            10
        );
    }

    #[test]
    fn lazy_typegen_matches_eager() {
        use crate::doc::typegen::{generate, generate_from_shape, TypegenLang};
        let json = r#"{"id":1,"uid":18446744073709551615,"name":"x","tags":["a","b"],"meta":{"k":1.5,"big":18446744073709551616},"opt":null,"rows":[{"a":1},{"a":2,"b":3}]}"#;
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
    fn array_field_text_extracts_scalars_as_written() {
        let d =
            doc(r#"[{"n": "Hello"}, {"n": 42}, {"n": true}, {"n": null}, {"n": {"k":1}}, {}, 99]"#);
        let cells = d.array_field_text(&Path::root(), "n").unwrap();
        assert_eq!(
            cells,
            vec![
                Some("Hello".into()),
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
    fn array_field_text_handles_escapes() {
        let d = doc(r#"[{"n": "Hello\nWorld"}, {"n": "Aé"}]"#);
        let cells = d.array_field_text(&Path::root(), "n").unwrap();
        assert_eq!(cells, vec![Some("Hello\nWorld".into()), Some("Aé".into())]);
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

    #[test]
    fn ndjson_writes_each_pretty_record_on_one_line_like_the_eager_writer() {
        use crate::doc::backend::DocumentBackend;
        let text = "[\n  {\n    \"a\": 1,\n    \"b\": [\n      1,\n      2\n    ]\n  },\n  {\n    \"a\": 2\n  }\n]";
        let eager: Value = serde_json::from_str(text).unwrap();
        assert_eq!(
            DocumentBackend::serialize_ndjson(&doc(text)),
            DocumentBackend::serialize_ndjson(&eager)
        );
    }

    #[test]
    fn a_lone_surrogate_is_refused_at_open_with_the_eager_error() {
        for text in [
            r#"{"s":"\ud83d","x":1}"#,
            r#"{"ok":1,"\ud800":2,"z":3}"#,
            r#"["\udc00"]"#,
            r#"["\ud83d\u0041"]"#,
        ] {
            let DocError::Parse(eager) = parse_json::<Value>(text).unwrap_err() else {
                panic!("{text}: eager should refuse with a parse error");
            };
            match LazyDoc::new(FastStr::new(text)) {
                Err(DocError::Parse(lazy)) => assert_eq!(lazy, eager, "{text}"),
                other => panic!("{text}: lazy open gave {other:?}, eager gave {eager}"),
            }
        }
        doc(r#"["\ud83d\ude00", "\\ud800"]"#);
    }
}
