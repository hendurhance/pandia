use std::collections::HashMap;
use std::ops::Range;
use std::path::Path as FsPath;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sonic_rs::FastStr;

use super::atomic;
use super::backend::DocumentBackend;
use super::cell::{cmp_cells, Cell};
use super::eager::{cmp_cell, replace_in_value, ReplaceCounts};
use super::export::{export as export_value, ExportError, ExportFormat};
use super::format::{self, InputFormat};
use super::grid_filter::{compile_filters, row_passes, GridFilter};
use super::history::History;
use super::lazy::{parse_json, LazyDoc};
use super::mapped::MappedText;
use super::ops::{Op, OpDescription, OpOutcome};
use super::schema_validate::{self, SchemaCompileError, SchemaValidationResult, Validator};
use super::search::{literal_matcher, SearchHit, SearchOptions};
use super::tier::{Capabilities, Tier, EDIT_SIZE_LIMIT, MAPPED_THRESHOLD_BYTES};
use super::typegen::{self, TypeShape, TypegenLang};
use super::types::{
    BigFileProblem, DocError, DocResult, FileOp, NodeKind, NodeView, Path, PathSegment,
};
use super::wire::LosslessText;

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub version: u64,
    pub affected_paths: Vec<Path>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryView {
    pub undo: Vec<OpDescription>,
    pub redo: Vec<OpDescription>,
    pub cap: u32,
}

#[derive(Debug)]
pub struct Document {
    inner: DocumentImpl,
    pub source_path: Option<String>,
    pub file_path: Option<String>,
    pub source_size: u64,
    pub recovery_note: Option<String>,
    pub comments_stripped: bool,
    pub version: u64,
    pub saved_version: u64,
    saved_hash: blake3::Hash,
    opened_lazy: bool,
    hash_cache: parking_lot::Mutex<Option<(u64, blake3::Hash)>>,
    history: History,
    sort_cache: parking_lot::Mutex<Option<SortCache>>,
    filter_cache: parking_lot::Mutex<Option<FilterCache>>,
    quick_text_cache: parking_lot::Mutex<HashMap<(Path, String), QuickTextColumn>>,
    canon_cache: parking_lot::Mutex<Option<CanonCache>>,
    schema_cache: parking_lot::Mutex<Option<(blake3::Hash, Arc<Validator>)>>,
    save_lock: Arc<parking_lot::Mutex<()>>,
}

#[derive(Debug)]
struct CanonCache {
    version: u64,
    text: Arc<String>,
    line_starts: Arc<Vec<u32>>,
}

#[derive(Debug)]
struct QuickTextColumn {
    version: u64,
    text: Arc<Vec<Option<String>>>,
}

#[derive(Debug)]
struct SortCache {
    path: Path,
    key: String,
    descending: bool,
    version: u64,
    perm: Vec<u32>,
}

#[derive(Debug)]
struct FilterCache {
    path: Path,
    groups: Vec<Vec<GridFilter>>,
    quick: Option<String>,
    quick_keys: Vec<String>,
    sort: Option<(String, bool)>,
    version: u64,
    perm: Vec<u32>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnValue {
    pub value: LosslessText,
    pub count: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnValues {
    pub values: Vec<ColumnValue>,
    pub capped: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortedRow {
    pub index: u32,
    pub value: Value,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredRows {
    pub total: u32,
    pub rows: Vec<SortedRow>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub count: u32,
    pub values: u32,
    pub keys: u32,
    pub applied: Option<ApplyResult>,
}

#[derive(Debug)]
enum DocumentImpl {
    Eager(Value),
    Lazy(LazyDoc),
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub root_kind: NodeKind,
    pub root_child_count: Option<u32>,
    pub source_path: Option<String>,
    pub source_size: u64,
    pub lazy: bool,
    pub tier: Tier,
    pub capabilities: Capabilities,
    pub version: u64,
    pub dirty: bool,
    pub file_backed: bool,
    pub recovery_note: Option<String>,
    pub comments_stripped: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub version: u64,
}

pub struct PendingSave {
    target: String,
    text: String,
    version: u64,
    hash: blake3::Hash,
}

impl PendingSave {
    pub fn write(&self) -> DocResult<()> {
        let target = FsPath::new(&self.target);
        atomic::write_atomic(target, |w| {
            std::io::Write::write_all(w, self.text.as_bytes())
        })
        .map_err(|e| DocError::file(FileOp::Save, target, e))
    }
}

impl Document {
    fn ensure_in_memory(size: u64) -> DocResult<()> {
        if size > MAPPED_THRESHOLD_BYTES {
            return Err(DocError::TooLarge {
                actual: size,
                limit: MAPPED_THRESHOLD_BYTES,
            });
        }
        Ok(())
    }

    fn parse(text: &FastStr) -> DocResult<DocumentImpl> {
        match Tier::of(text.len() as u64) {
            Tier::Small => parse_json(text).map(DocumentImpl::Eager),
            _ => Ok(DocumentImpl::Lazy(LazyDoc::new(text.clone())?)),
        }
    }

    fn parse_records(text: &FastStr) -> DocResult<DocumentImpl> {
        if text.bytes().all(|b| b.is_ascii_whitespace()) {
            return Ok(DocumentImpl::Eager(Value::Array(Vec::new())));
        }
        match Self::parse(text)? {
            DocumentImpl::Eager(record) => Ok(DocumentImpl::Eager(Value::Array(vec![record]))),
            DocumentImpl::Lazy(_) => Self::parse(&FastStr::from_string(format!("[{text}]"))),
        }
    }

    pub fn from_text(text: &str, source_path: Option<String>) -> DocResult<Self> {
        Self::from_source(FastStr::new(text), source_path)
    }

    pub fn from_source(text: FastStr, source_path: Option<String>) -> DocResult<Self> {
        Self::ensure_in_memory(text.len() as u64)?;

        let hint = source_path.as_deref().and_then(format::hint_from_path);
        let parsed = if hint == Some(InputFormat::Ndjson) {
            Self::parse_records(&text)
        } else {
            Self::parse(&text)
        };
        let (inner, size, recovery_note, comments_stripped) = match parsed {
            Ok(inner) => (inner, text.len() as u64, None, false),
            Err(strict) => {
                let r = format::recover(&text, hint).ok_or(strict)?;
                Self::ensure_in_memory(r.json.len() as u64)?;
                let size = r.json.len() as u64;
                (
                    Self::parse(&FastStr::from_string(r.json))?,
                    size,
                    r.note.map(str::to_string),
                    r.comments_stripped,
                )
            }
        };
        Ok(Self::assemble(
            inner,
            source_path,
            size,
            recovery_note,
            comments_stripped,
        ))
    }

    pub fn from_mapped(text: Arc<MappedText>, source_path: Option<String>) -> DocResult<Self> {
        if source_path.as_deref().and_then(format::hint_from_path) == Some(InputFormat::Ndjson) {
            return Err(DocError::BigFile(BigFileProblem::LinePerValue {
                file: text.name(),
            }));
        }
        let size = text.as_str().len() as u64;
        let recovery_note = text
            .skipped_bom()
            .then(|| format::LEADING_JUNK_NOTE.to_string());
        let inner = DocumentImpl::Lazy(LazyDoc::mapped(text)?);
        Ok(Self::assemble(
            inner,
            source_path,
            size,
            recovery_note,
            false,
        ))
    }

    fn assemble(
        inner: DocumentImpl,
        source_path: Option<String>,
        source_size: u64,
        recovery_note: Option<String>,
        comments_stripped: bool,
    ) -> Self {
        let mut doc = Self {
            opened_lazy: matches!(inner, DocumentImpl::Lazy(_)),
            inner,
            source_path,
            file_path: None,
            source_size,
            recovery_note,
            comments_stripped,
            version: 0,
            saved_version: 0,
            saved_hash: blake3::Hash::from_bytes([0u8; 32]),
            hash_cache: parking_lot::Mutex::new(None),
            history: History::default(),
            sort_cache: parking_lot::Mutex::new(None),
            filter_cache: parking_lot::Mutex::new(None),
            quick_text_cache: parking_lot::Mutex::new(HashMap::new()),
            canon_cache: parking_lot::Mutex::new(None),
            schema_cache: parking_lot::Mutex::new(None),
            save_lock: Arc::default(),
        };
        if !doc.opened_lazy {
            doc.saved_hash = doc.compute_content_hash();
        }
        doc
    }

    pub fn tier(&self) -> Tier {
        match &self.inner {
            DocumentImpl::Lazy(lazy) if lazy.is_mapped() => Tier::Mapped,
            _ => Tier::of(self.source_size),
        }
    }

    pub fn capabilities(&self) -> Capabilities {
        self.tier().capabilities(self.source_size)
    }

    pub fn check_source(&self) -> DocResult<()> {
        match &self.inner {
            DocumentImpl::Lazy(lazy) => lazy.check_unchanged(),
            DocumentImpl::Eager(_) => Ok(()),
        }
    }

    fn require_whole_document(&self) -> DocResult<()> {
        if self.tier().whole_document() {
            return Ok(());
        }
        Err(DocError::TooLarge {
            actual: self.source_size,
            limit: EDIT_SIZE_LIMIT,
        })
    }

    fn require_in_memory(&self) -> DocResult<()> {
        if self.tier() != Tier::Mapped {
            return Ok(());
        }
        Err(DocError::TooLarge {
            actual: self.source_size,
            limit: MAPPED_THRESHOLD_BYTES,
        })
    }

    fn backend(&self) -> &dyn DocumentBackend {
        match &self.inner {
            DocumentImpl::Eager(v) => v,
            DocumentImpl::Lazy(d) => d,
        }
    }

    fn is_lazy(&self) -> bool {
        matches!(self.inner, DocumentImpl::Lazy(_))
    }

    fn with_root<R>(&self, f: impl FnOnce(&Value) -> R) -> DocResult<R> {
        match self.backend().borrowed_root() {
            Some(v) => Ok(f(v)),
            None => {
                let v = self.backend().get_value(&Path::root())?;
                Ok(f(&v))
            }
        }
    }

    fn compute_content_hash(&self) -> blake3::Hash {
        let mut hasher = blake3::Hasher::new();
        if self.backend().hash_into(&mut hasher).is_err() {
            return blake3::Hash::from_bytes([0u8; 32]);
        }
        hasher.finalize()
    }

    fn current_hash(&self) -> blake3::Hash {
        let mut cache = self.hash_cache.lock();
        if let Some((v, h)) = *cache {
            if v == self.version {
                return h;
            }
        }
        let h = self.compute_content_hash();
        *cache = Some((self.version, h));
        h
    }

    fn is_dirty(&self) -> bool {
        if self.version == self.saved_version {
            return false;
        }

        if self.opened_lazy {
            return !self.history.at_saved();
        }
        self.current_hash() != self.saved_hash
    }

    pub fn read_text_file(path: &FsPath) -> DocResult<String> {
        let size = std::fs::metadata(path)
            .map_err(|e| DocError::file(FileOp::Open, path, e))?
            .len();
        Self::ensure_in_memory(size)?;
        std::fs::read_to_string(path).map_err(|e| DocError::file(FileOp::Open, path, e))
    }

    #[cfg(test)]
    pub fn from_file<P: AsRef<FsPath>>(path: P) -> DocResult<Self> {
        let p = path.as_ref();
        let text = Self::read_text_file(p)?;
        let path_str = p.to_string_lossy().into_owned();
        let mut doc = Self::from_text(&text, Some(path_str.clone()))?;
        doc.file_path = Some(path_str);
        Ok(doc)
    }

    pub fn root_preview(&self) -> String {
        self.backend().root_preview()
    }

    pub fn summary(&self) -> Summary {
        let (root_kind, root_child_count) = self.backend().root_kind_and_count();
        Summary {
            root_kind,
            root_child_count,
            source_path: self.source_path.clone(),
            source_size: self.source_size,
            lazy: self.is_lazy(),
            tier: self.tier(),
            capabilities: self.capabilities(),
            version: self.version,
            dirty: self.is_dirty(),
            file_backed: self.file_path.is_some(),
            recovery_note: self.recovery_note.clone(),
            comments_stripped: self.comments_stripped,
        }
    }

    pub fn export(&self, format: ExportFormat) -> DocResult<String> {
        self.require_whole_document()?;
        self.with_root(|v| export_value(v, format))?
            .map_err(|e| DocError::Export(e.to_string()))
    }

    pub fn export_to_file(&self, format: ExportFormat, path: &str) -> DocResult<()> {
        self.require_in_memory()?;
        let target = FsPath::new(path);
        match format {
            ExportFormat::Json | ExportFormat::JsonMin => {
                let pretty = matches!(format, ExportFormat::Json);
                atomic::write_atomic(target, |w| {
                    self.backend().write_json(pretty, w).map_err(|e| match e {
                        ExportError::Io(e) => e,
                        e => std::io::Error::other(e),
                    })
                })
            }
            _ => {
                let full = self.export(format)?;
                atomic::write_atomic(target, |w| std::io::Write::write_all(w, full.as_bytes()))
            }
        }
        .map_err(|e| DocError::file(FileOp::Export, target, e))
    }

    pub fn export_preview(
        &self,
        format: ExportFormat,
        max_chars: usize,
    ) -> DocResult<(String, bool)> {
        self.require_in_memory()?;
        let max_bytes = max_chars.saturating_mul(4).max(1024);
        match format {
            ExportFormat::Json | ExportFormat::JsonMin => {
                let pretty = matches!(format, ExportFormat::Json);
                let (mut text, mut truncated) = self.backend().preview_json(pretty, max_bytes)?;
                if text.chars().count() > max_chars {
                    text = text.chars().take(max_chars).collect();
                    truncated = true;
                }
                Ok((text, truncated))
            }
            _ => {
                let full = self.export(format)?;
                if full.chars().count() > max_chars {
                    Ok((full.chars().take(max_chars).collect(), true))
                } else {
                    Ok((full, false))
                }
            }
        }
    }

    pub fn serialize(&self) -> DocResult<String> {
        self.require_in_memory()?;
        self.backend().serialize_pretty()
    }

    fn serialize_ndjson(&self) -> Option<String> {
        self.backend().serialize_ndjson()
    }

    #[cfg(test)]
    pub fn save(&mut self, path: Option<String>) -> DocResult<SaveResult> {
        let pending = self.prepare_save(path)?;
        pending.write()?;
        Ok(self.finish_save(&pending))
    }

    pub fn save_lock(&self) -> Arc<parking_lot::Mutex<()>> {
        Arc::clone(&self.save_lock)
    }

    pub fn prepare_save(&self, path: Option<String>) -> DocResult<PendingSave> {
        let target = path
            .or_else(|| self.file_path.clone())
            .ok_or_else(|| DocError::Edit("no file path — use Save As".into()))?;
        let text = match format::hint_from_path(&target) {
            Some(InputFormat::Ndjson) => match self.serialize_ndjson() {
                Some(text) => text,
                None => self.serialize()?,
            },
            _ => self.serialize()?,
        };
        Ok(PendingSave {
            target,
            text,
            version: self.version,
            hash: self.content_hash_for_dirty_check(),
        })
    }

    pub fn finish_save(&mut self, saved: &PendingSave) -> SaveResult {
        self.comments_stripped = false;
        self.file_path = Some(saved.target.clone());
        self.source_path = Some(saved.target.clone());
        self.source_size = saved.text.len() as u64;
        self.saved_version = saved.version;
        self.saved_hash = saved.hash;
        if self.version == saved.version {
            self.history.mark_saved();
        } else {
            self.history.forget_saved();
        }
        SaveResult {
            path: saved.target.clone(),
            version: saved.version,
        }
    }

    pub fn save_copy(&mut self, target: &str) -> DocResult<()> {
        use std::io::Write;
        let text = self.serialize()?;
        std::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(target)
            .and_then(|mut file| file.write_all(text.as_bytes()))
            .map_err(|e| DocError::file(FileOp::Save, FsPath::new(target), e))?;
        self.mark_saved();
        Ok(())
    }

    fn mark_saved(&mut self) {
        self.history.mark_saved();
        self.saved_version = self.version;
        let saved_hash = self.content_hash_for_dirty_check();
        self.saved_hash = saved_hash;
        *self.hash_cache.lock() = Some((self.version, saved_hash));
    }

    fn content_hash_for_dirty_check(&self) -> blake3::Hash {
        if self.opened_lazy {
            return blake3::Hash::from_bytes([0u8; 32]);
        }
        self.current_hash()
    }

    pub fn mark_unsaved(&mut self) {
        self.history.forget_saved();
        self.saved_version = u64::MAX;
        self.saved_hash = blake3::Hash::from_bytes([0u8; 32]);
    }

    pub fn get_slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>> {
        self.backend().slice(path, range)
    }

    pub fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        if path.is_root() {
            let s = self.summary();
            return Ok((s.root_kind, s.root_child_count));
        }
        self.backend().kind_at(path)
    }

    pub fn child_count_at(&self, path: &Path) -> DocResult<Option<u32>> {
        self.backend().child_count_at(path)
    }

    pub fn get_rows(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<Value>> {
        self.backend().rows(path, range)
    }

    pub fn get_rows_sorted(
        &self,
        path: &Path,
        key: &str,
        descending: bool,
        range: Range<u32>,
    ) -> DocResult<Vec<SortedRow>> {
        self.require_in_memory()?;
        self.with_sorted_perm(path, key, descending, |perm| {
            self.window_sorted(perm, path, range)
        })
    }

    fn with_sorted_perm<R>(
        &self,
        path: &Path,
        key: &str,
        descending: bool,
        f: impl FnOnce(&[u32]) -> DocResult<R>,
    ) -> DocResult<R> {
        {
            let cache = self.sort_cache.lock();
            if let Some(c) = cache.as_ref() {
                if c.path == *path
                    && c.key == key
                    && c.descending == descending
                    && c.version == self.version
                {
                    return f(&c.perm);
                }
            }
        }

        let cells = self.column_keys(path, key)?;
        let mut perm: Vec<u32> = (0..cells.len() as u32).collect();
        perm.sort_by(|&a, &b| {
            let ord = cmp_cells(&cells[a as usize], &cells[b as usize]);
            if descending {
                ord.reverse()
            } else {
                ord
            }
        });

        let cache = {
            let mut guard = self.sort_cache.lock();
            *guard = Some(SortCache {
                path: path.clone(),
                key: key.to_string(),
                descending,
                version: self.version,
                perm,
            });
            guard
        };
        f(&cache.as_ref().expect("just set").perm)
    }

    fn window_sorted(
        &self,
        perm: &[u32],
        path: &Path,
        range: Range<u32>,
    ) -> DocResult<Vec<SortedRow>> {
        let total = perm.len() as u32;
        let start = range.start.min(total);
        let end = range.end.min(total);
        let mut out = Vec::with_capacity((end - start) as usize);
        for d in start..end {
            let orig = perm[d as usize];
            let mut p = path.clone();
            p.push(PathSegment::Index(orig));
            out.push(SortedRow {
                index: orig,
                value: self.get_value(&p)?,
            });
        }
        Ok(out)
    }

    fn column_cells(&self, path: &Path, key: &str) -> DocResult<Vec<Option<Value>>> {
        self.backend().column_cells(path, key)
    }

    fn column_keys(&self, path: &Path, key: &str) -> DocResult<Vec<Cell<'_>>> {
        self.backend().column_keys(path, key)
    }

    pub fn for_each_row_field(
        &self,
        path: &Path,
        cancel: &crate::doc::jobs::CancelFlag,
        f: &mut dyn FnMut(&str, NodeKind),
    ) -> DocResult<u32> {
        self.backend().for_each_row_field(path, cancel, f)
    }

    fn compute_column_text(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>> {
        self.backend().column_text(path, key)
    }

    fn quick_text_column(&self, path: &Path, key: &str) -> DocResult<Arc<Vec<Option<String>>>> {
        let cache_key = (path.clone(), key.to_string());
        {
            let cache = self.quick_text_cache.lock();
            if let Some(entry) = cache.get(&cache_key) {
                if entry.version == self.version {
                    return Ok(entry.text.clone());
                }
            }
        }
        let text = Arc::new(self.compute_column_text(path, key)?);
        self.quick_text_cache.lock().insert(
            cache_key,
            QuickTextColumn {
                version: self.version,
                text: text.clone(),
            },
        );
        Ok(text)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_rows_filtered(
        &self,
        path: &Path,
        groups: &[Vec<GridFilter>],
        quick: Option<&str>,
        quick_keys: &[String],
        sort: Option<(&str, bool)>,
        range: Range<u32>,
        cancel: &crate::doc::jobs::CancelFlag,
    ) -> DocResult<FilteredRows> {
        self.require_in_memory()?;
        self.with_filtered_perm(path, groups, quick, quick_keys, sort, cancel, |perm| {
            self.window_filtered(perm, path, range)
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn with_filtered_perm<R>(
        &self,
        path: &Path,
        groups: &[Vec<GridFilter>],
        quick: Option<&str>,
        quick_keys: &[String],
        sort: Option<(&str, bool)>,
        cancel: &crate::doc::jobs::CancelFlag,
        f: impl FnOnce(&[u32]) -> DocResult<R>,
    ) -> DocResult<R> {
        let sort_owned = sort.map(|(k, d)| (k.to_string(), d));
        let quick_norm = quick.map(str::trim).filter(|q| !q.is_empty());
        let quick_owned = quick_norm.map(str::to_string);

        {
            let cache = self.filter_cache.lock();
            if let Some(c) = cache.as_ref() {
                if c.path == *path
                    && c.groups == groups
                    && c.quick.as_deref() == quick_norm
                    && c.quick_keys == quick_keys
                    && c.sort == sort_owned
                    && c.version == self.version
                {
                    return f(&c.perm);
                }
            }
        }

        let narrow_seed: Option<Vec<u32>> = {
            let cache = self.filter_cache.lock();
            cache.as_ref().and_then(|c| {
                if c.path != *path
                    || c.groups != groups
                    || c.quick_keys != quick_keys
                    || c.sort != sort_owned
                    || c.version != self.version
                {
                    return None;
                }
                match (c.quick.as_deref(), quick_norm) {
                    (Some(prev), Some(curr))
                        if curr.len() > prev.len() && curr.starts_with(prev) =>
                    {
                        Some(c.perm.clone())
                    }
                    _ => None,
                }
            })
        };

        let mut key_cells: HashMap<String, Vec<Cell<'_>>> = HashMap::new();
        for grp in groups {
            for f in grp {
                if !key_cells.contains_key(f.key.as_str()) {
                    key_cells.insert(f.key.clone(), self.column_keys(path, &f.key)?);
                }
            }
        }
        if let Some((sk, _)) = sort {
            if !key_cells.contains_key(sk) {
                key_cells.insert(sk.to_string(), self.column_keys(path, sk)?);
            }
        }

        let filters = compile_filters(groups).map_err(|e| DocError::Parse(e.to_string()))?;
        let quick_matcher = quick_norm
            .map(|q| literal_matcher(q, false))
            .transpose()
            .map_err(|e| DocError::Parse(e.to_string()))?;
        let mut quick_text: HashMap<String, Arc<Vec<Option<String>>>> = HashMap::new();
        if quick_matcher.is_some() {
            self.quick_text_cache.lock().retain(|(p, k), entry| {
                entry.version == self.version && p == path && quick_keys.contains(k)
            });
            for k in quick_keys {
                if !quick_text.contains_key(k) {
                    quick_text.insert(k.clone(), self.quick_text_column(path, k)?);
                }
            }
        }

        let n = key_cells
            .values()
            .next()
            .map(Vec::len)
            .or_else(|| quick_text.values().next().map(|v| v.len()))
            .unwrap_or(0);

        let candidate_indices: Box<dyn Iterator<Item = u32>> = match narrow_seed {
            Some(perm) => Box::new(perm.into_iter()),
            None => Box::new(0..n as u32),
        };

        let mut perm: Vec<u32> = Vec::new();
        let mut checked: u32 = 0;
        for i in candidate_indices {
            checked = checked.wrapping_add(1);
            if checked & 0x0FFF == 0 && cancel.is_cancelled() {
                return Err(DocError::Cancelled);
            }
            let pass_filters = row_passes(&filters, |k| {
                key_cells.get(k).and_then(|c| c.get(i as usize))
            });
            if !pass_filters {
                continue;
            }
            let pass_quick = match &quick_matcher {
                None => true,
                Some(q) => {
                    quick_keys.is_empty()
                        || quick_keys.iter().any(|k| {
                            quick_text
                                .get(k)
                                .and_then(|c| c.get(i as usize))
                                .and_then(|o| o.as_deref())
                                .map(|t| q.is_match(t))
                                .unwrap_or(false)
                        })
                }
            };
            if pass_quick {
                perm.push(i);
            }
        }

        if let Some((sk, desc)) = sort {
            let cells = &key_cells[sk];
            perm.sort_by(|&a, &b| {
                let ord = cmp_cells(&cells[a as usize], &cells[b as usize]);
                if desc {
                    ord.reverse()
                } else {
                    ord
                }
            });
        }

        let cache = {
            let mut guard = self.filter_cache.lock();
            *guard = Some(FilterCache {
                path: path.clone(),
                groups: groups.to_vec(),
                quick: quick_owned,
                quick_keys: quick_keys.to_vec(),
                sort: sort_owned,
                version: self.version,
                perm,
            });
            guard
        };
        f(&cache.as_ref().expect("just set").perm)
    }

    fn window_filtered(
        &self,
        perm: &[u32],
        path: &Path,
        range: Range<u32>,
    ) -> DocResult<FilteredRows> {
        let total = perm.len() as u32;
        let start = range.start.min(total);
        let end = range.end.min(total);
        let mut rows = Vec::with_capacity((end - start) as usize);
        for d in start..end {
            let orig = perm[d as usize];
            let mut p = path.clone();
            p.push(PathSegment::Index(orig));
            rows.push(SortedRow {
                index: orig,
                value: self.get_value(&p)?,
            });
        }
        Ok(FilteredRows { total, rows })
    }

    pub fn get_row_indices(
        &self,
        path: &Path,
        groups: &[Vec<GridFilter>],
        quick: Option<&str>,
        quick_keys: &[String],
        sort: Option<(&str, bool)>,
        range: Range<u32>,
    ) -> DocResult<Vec<u32>> {
        let window = |perm: &[u32]| -> DocResult<Vec<u32>> {
            let total = perm.len() as u32;
            Ok((range.start.min(total)..range.end.min(total))
                .map(|d| perm[d as usize])
                .collect())
        };
        if !groups.is_empty() || quick.is_some() || sort.is_some() {
            self.require_in_memory()?;
        }
        if !groups.is_empty() || quick.is_some() {
            let never = crate::doc::jobs::CancelFlag::never();
            return self.with_filtered_perm(path, groups, quick, quick_keys, sort, &never, window);
        }
        match sort {
            Some((key, descending)) => self.with_sorted_perm(path, key, descending, window),
            None => {
                let total = match self.kind_at(path)? {
                    (NodeKind::Array, count) => count.unwrap_or(0),
                    _ => 0,
                };
                Ok((range.start.min(total)..range.end.min(total)).collect())
            }
        }
    }

    pub fn column_values(&self, path: &Path, key: &str, limit: usize) -> DocResult<ColumnValues> {
        self.require_in_memory()?;
        let cells = self.column_keys(path, key)?;
        let mut map: std::collections::HashMap<String, (Value, u32)> =
            std::collections::HashMap::new();
        let mut capped = false;
        for c in &cells {
            let v = c.to_value();
            let k = v.to_string();
            if let Some(e) = map.get_mut(&k) {
                e.1 += 1;
            } else if map.len() < limit {
                map.insert(k, (v, 1));
            } else {
                capped = true;
            }
        }
        let mut values: Vec<(Value, u32)> = map.into_values().collect();
        values.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| cmp_cell(Some(&a.0), Some(&b.0))));
        let values = values
            .into_iter()
            .map(|(value, count)| ColumnValue {
                value: LosslessText::from_value(&value),
                count,
            })
            .collect();
        Ok(ColumnValues { values, capped })
    }

    pub fn get_rows_at(&self, path: &Path, indices: &[u32]) -> DocResult<Vec<Value>> {
        let mut out = Vec::with_capacity(indices.len());
        for &i in indices {
            let mut p = path.clone();
            p.push(PathSegment::Index(i));
            out.push(self.get_value(&p)?);
        }
        Ok(out)
    }

    pub fn get_column(&self, path: &Path, key: &str) -> DocResult<Vec<Value>> {
        if path.is_root() {
            self.require_whole_document()?;
        }
        Ok(self
            .column_cells(path, key)?
            .into_iter()
            .flatten()
            .collect())
    }

    pub fn get_value(&self, path: &Path) -> DocResult<Value> {
        if path.is_root() {
            self.require_whole_document()?;
        }
        self.backend().get_value(path)
    }

    pub fn canonical_lines(&self) -> DocResult<(Arc<String>, Arc<Vec<u32>>)> {
        {
            let cache = self.canon_cache.lock();
            if let Some(c) = cache.as_ref() {
                if c.version == self.version {
                    return Ok((Arc::clone(&c.text), Arc::clone(&c.line_starts)));
                }
            }
        }
        self.require_whole_document()?;
        let text = self.with_root(super::canonical::canonical_pretty)?;
        let text = Arc::new(text);
        let line_starts = Arc::new(super::linediff::line_starts(&text));
        *self.canon_cache.lock() = Some(CanonCache {
            version: self.version,
            text: Arc::clone(&text),
            line_starts: Arc::clone(&line_starts),
        });
        Ok((text, line_starts))
    }

    pub fn canonical_offsets(&self, paths: &[Path]) -> DocResult<Vec<Option<(u64, u64)>>> {
        self.require_whole_document()?;
        self.with_root(|v| super::canonical::canonical_offsets(v, paths))
    }

    pub fn apply(&mut self, op: &Op) -> DocResult<ApplyResult> {
        let (result, inverse) = self.apply_unchecked(op)?;
        self.history.record(op.clone(), inverse);
        Ok(result)
    }

    fn apply_unchecked(&mut self, op: &Op) -> DocResult<(ApplyResult, Op)> {
        let root = self.ensure_eager()?;
        let OpOutcome {
            inverse,
            affected_paths,
        } = op.apply(root)?;
        self.version += 1;
        Ok((
            ApplyResult {
                version: self.version,
                affected_paths,
            },
            inverse,
        ))
    }

    pub fn undo(&mut self) -> DocResult<Option<ApplyResult>> {
        let Some((forward, inverse)) = self.history.pop_undo() else {
            return Ok(None);
        };
        match self.apply_unchecked(&inverse) {
            Ok((result, _)) => {
                self.history.push_redo((forward, inverse));
                Ok(Some(result))
            }
            Err(e) => {
                self.history.push_undo((forward, inverse));
                Err(e)
            }
        }
    }

    pub fn redo(&mut self) -> DocResult<Option<ApplyResult>> {
        let Some((forward, inverse)) = self.history.pop_redo() else {
            return Ok(None);
        };
        match self.apply_unchecked(&forward) {
            Ok((result, _)) => {
                self.history.push_undo((forward, inverse));
                Ok(Some(result))
            }
            Err(e) => {
                self.history.push_redo((forward, inverse));
                Err(e)
            }
        }
    }

    #[allow(dead_code)]
    pub fn history_lens(&self) -> (usize, usize) {
        (self.history.undo_len(), self.history.redo_len())
    }

    pub fn history_view(&self) -> HistoryView {
        HistoryView {
            undo: self.history.undo_ops().map(|op| op.describe()).collect(),
            redo: self.history.redo_ops().map(|op| op.describe()).collect(),
            cap: self.history.cap() as u32,
        }
    }

    pub fn search(
        &self,
        opts: &SearchOptions,
        cancel: &crate::doc::jobs::CancelFlag,
        report: &mut dyn FnMut(&[SearchHit], u64),
    ) -> DocResult<Vec<SearchHit>> {
        Ok(self.backend().search(opts, cancel, report))
    }

    pub fn replace_all(
        &mut self,
        needle: &str,
        replacement: &str,
        case_sensitive: bool,
    ) -> DocResult<ReplaceResult> {
        if needle.is_empty() {
            return Ok(ReplaceResult {
                count: 0,
                values: 0,
                keys: 0,
                applied: None,
            });
        }
        let re =
            literal_matcher(needle, case_sensitive).map_err(|e| DocError::Parse(e.to_string()))?;
        let mut root = self.get_value(&Path::root())?;
        let mut count = ReplaceCounts::default();
        replace_in_value(&mut root, &re, replacement, &mut count);
        if count.matches == 0 {
            return Ok(ReplaceResult {
                count: 0,
                values: 0,
                keys: 0,
                applied: None,
            });
        }
        let applied = self.apply(&Op::SetValue {
            path: Path::root(),
            value: root,
        })?;
        Ok(ReplaceResult {
            count: count.matches,
            values: count.values,
            keys: count.keys,
            applied: Some(applied),
        })
    }

    pub fn infer_shape(&self) -> TypeShape {
        match &self.inner {
            DocumentImpl::Eager(v) => typegen::infer(v),
            DocumentImpl::Lazy(d) => d.infer_shape(),
        }
    }

    pub fn generate_types(&self, lang: TypegenLang, type_name: &str) -> DocResult<String> {
        self.require_in_memory()?;
        if lang == TypegenLang::JsonSchema {
            self.require_whole_document()?;
        }
        self.backend().generate_types(lang, type_name)
    }

    pub fn validate_schema(
        &self,
        schema_text: &str,
        cancel: &crate::doc::jobs::CancelFlag,
    ) -> DocResult<SchemaValidationResult> {
        self.require_whole_document()?;
        let validator = self.compiled_schema(schema_text)?;
        if cancel.is_cancelled() {
            return Err(DocError::Cancelled);
        }
        self.with_root(|v| schema_validate::run(&validator, v, cancel))?
            .ok_or(DocError::Cancelled)
    }

    fn compiled_schema(&self, schema_text: &str) -> DocResult<Arc<Validator>> {
        let key = blake3::hash(schema_text.as_bytes());
        if let Some((k, v)) = self.schema_cache.lock().as_ref() {
            if *k == key {
                return Ok(Arc::clone(v));
            }
        }
        let validator = Arc::new(schema_validate::compile(schema_text).map_err(|e| match e {
            SchemaCompileError::Parse(s) => DocError::Schema(format!("not valid JSON: {s}")),
            SchemaCompileError::Compile(s) => DocError::Schema(format!("compile error: {s}")),
            SchemaCompileError::ExternalRef(uri) => DocError::SchemaExternalRef(uri),
        })?);
        *self.schema_cache.lock() = Some((key, Arc::clone(&validator)));
        Ok(validator)
    }

    pub fn check_editable(&self) -> DocResult<()> {
        self.require_whole_document()
    }

    fn ensure_eager(&mut self) -> DocResult<&mut Value> {
        if matches!(self.inner, DocumentImpl::Lazy(_)) {
            self.check_editable()?;
            let DocumentImpl::Lazy(lazy) = &self.inner else {
                unreachable!("checked above")
            };
            let value: Value = parse_json(lazy.source())?;
            self.inner = DocumentImpl::Eager(value);
        }
        match &mut self.inner {
            DocumentImpl::Eager(v) => Ok(v),
            DocumentImpl::Lazy(_) => unreachable!("just materialized above"),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_scalar_root_has_a_short_preview_without_reading_the_whole_value() {
        let long = "x".repeat(LAZY_THRESHOLD_BYTES as usize);
        let lazy = Document::from_text(&format!("\"{long}\""), None).unwrap();
        assert!(lazy.is_lazy());
        let preview = lazy.root_preview();
        assert_eq!(preview.chars().count(), 1003);
        assert!(preview.starts_with("\"xxx") && preview.ends_with("\u{2026}\""));
        assert_eq!(
            doc("12345678901234567890").root_preview(),
            "12345678901234567890"
        );
        assert_eq!(doc("true").root_preview(), "true");
        assert_eq!(doc(r#""hi""#).root_preview(), r#""hi""#);
    }

    #[test]
    fn a_scalar_root_preview_unescapes_and_cuts_at_1000_characters_on_both_backends() {
        let pad = " ".repeat(LAZY_THRESHOLD_BYTES as usize);
        let emoji = "\u{1F600}".repeat(1001);
        let cases = [
            (
                r#""he said \"hi\"""#.to_string(),
                r#""he said "hi"""#.to_string(),
            ),
            (
                format!("\"{emoji}\""),
                format!("\"{}\u{2026}\"", "\u{1F600}".repeat(1000)),
            ),
            (
                "12345678901234567890.10".to_string(),
                "12345678901234567890.10".to_string(),
            ),
            ("null".to_string(), "null".to_string()),
        ];
        for (text, want) in cases {
            assert_eq!(doc(&text).root_preview(), want, "eager {text:.40}");
            let lazy = doc(&format!("{text}{pad}"));
            assert!(lazy.is_lazy());
            assert_eq!(lazy.root_preview(), want, "lazy {text:.40}");
        }
    }

    #[test]
    fn a_repeated_schema_check_reuses_the_compiled_schema() {
        let d = doc(r#"{"id": 1}"#);
        let schema = r#"{"type": "object", "required": ["id"]}"#;
        let never = crate::doc::jobs::CancelFlag::never();
        assert!(d.validate_schema(schema, &never).unwrap().valid);
        let first = d
            .schema_cache
            .lock()
            .as_ref()
            .map(|(_, v)| Arc::clone(v))
            .unwrap();
        assert!(d.validate_schema(schema, &never).unwrap().valid);
        let second = d
            .schema_cache
            .lock()
            .as_ref()
            .map(|(_, v)| Arc::clone(v))
            .unwrap();
        assert!(Arc::ptr_eq(&first, &second));

        assert!(
            !d.validate_schema(r#"{"type": "array"}"#, &never)
                .unwrap()
                .valid
        );
        let third = d
            .schema_cache
            .lock()
            .as_ref()
            .map(|(_, v)| Arc::clone(v))
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &third));
    }

    #[test]
    fn a_cancelled_schema_check_stops_with_cancelled() {
        let d = doc(r#"{"id": 1}"#);
        let cancel = crate::doc::jobs::CancelFlag::default();
        cancel.cancel();
        let err = d
            .validate_schema(r#"{"type": "object"}"#, &cancel)
            .unwrap_err();
        assert!(matches!(err, DocError::Cancelled), "{err:?}");
    }

    #[test]
    fn the_quick_filter_keeps_only_the_columns_it_is_searching() {
        let d = Document::from_text(
            r#"[{"a":"x","b":"y","c":"z"},{"a":"xx","b":"yy","c":"zz"}]"#,
            None,
        )
        .unwrap();
        let never = crate::doc::jobs::CancelFlag::never();
        let keys = |ks: &[&str]| ks.iter().map(|k| k.to_string()).collect::<Vec<_>>();
        let quick = |q: &str, ks: &[&str]| {
            d.get_rows_filtered(&Path::root(), &[], Some(q), &keys(ks), None, 0..10, &never)
                .unwrap()
                .total
        };
        assert_eq!(quick("x", &["a", "b"]), 2);
        assert_eq!(quick("zz", &["c"]), 1);
        let mut cached: Vec<String> = d
            .quick_text_cache
            .lock()
            .keys()
            .map(|(_, k)| k.clone())
            .collect();
        cached.sort();
        assert_eq!(cached, ["c"]);
    }

    #[test]
    #[ignore = "memory probe; run the test binary under /usr/bin/time -l"]
    fn probe_grid_sort_and_filter_memory() {
        use super::super::grid_filter::{FilterOp, GridFilter};
        use std::fmt::Write;
        const N: u32 = 2_000_000;
        let mut s = String::with_capacity(120_000_000);
        s.push_str("{\"rows\":[");
        for i in 0..N {
            if i > 0 {
                s.push(',');
            }
            write!(
                s,
                "{{\"id\":{i},\"name\":\"user {}\",\"score\":{}.5}}",
                N - i,
                i * 7 % 1000
            )
            .unwrap();
        }
        s.push_str("]}");
        let d = Document::from_text(&s, None).unwrap();
        drop(s);
        let rows = Path(vec![PathSegment::Key("rows".into())]);
        let never = crate::doc::jobs::CancelFlag::never();
        let t = std::time::Instant::now();
        let sorted = d.get_rows_sorted(&rows, "score", true, 0..3).unwrap();
        let sort_time = t.elapsed();
        let over = vec![vec![GridFilter {
            key: "score".into(),
            op: FilterOp::Gt,
            value: Some(serde_json::json!(500)),
        }]];
        let t = std::time::Instant::now();
        let filtered = d
            .get_rows_filtered(&rows, &over, None, &[], Some(("name", false)), 0..3, &never)
            .unwrap();
        let filter_time = t.elapsed();
        eprintln!(
            "[probe] sort {} rows in {sort_time:?} (top {:?}); filter+sort in {filter_time:?} ({} match)",
            N,
            sorted[0].value["score"],
            filtered.total
        );
    }

    use super::*;
    use crate::doc::mapped::TempFile;
    use crate::doc::tier::LAZY_THRESHOLD_BYTES;

    fn doc(text: &str) -> Document {
        Document::from_text(text, None).expect("valid JSON in test")
    }

    #[test]
    fn parse_invalid_returns_parse_error() {
        let err = Document::from_text("{not json", None).unwrap_err();
        assert!(matches!(err, DocError::Parse(_)));
    }

    #[test]
    fn text_over_the_mapped_threshold_is_never_held_in_memory() {
        assert!(Document::ensure_in_memory(MAPPED_THRESHOLD_BYTES).is_ok());
        let err = Document::ensure_in_memory(MAPPED_THRESHOLD_BYTES + 1).unwrap_err();
        assert!(matches!(
            err,
            DocError::TooLarge {
                limit: MAPPED_THRESHOLD_BYTES,
                ..
            }
        ));
    }

    const ROWS: &str = r#"[{"id": 1, "name": "ada"}, {"id": 2, "name": "grace"}]"#;

    fn mapped_doc(name: &str, text: &str) -> (TempFile, Document) {
        let file = TempFile::new(name, text);
        let doc = Document::from_mapped(file.map(), Some(name.into())).unwrap();
        (file, doc)
    }

    #[test]
    fn a_mapped_document_is_read_only_whatever_its_size() {
        let (_file, d) = mapped_doc("rows.json", ROWS);
        let s = d.summary();
        assert_eq!(s.tier, Tier::Mapped);
        assert!(s.lazy);
        assert_eq!(s.capabilities, Tier::Mapped.capabilities(s.source_size));
        assert_eq!(s.root_child_count, Some(2));
    }

    #[test]
    fn a_mapped_document_browses_pages_and_searches() {
        let (_file, d) = mapped_doc("rows.json", ROWS);
        let name = Path(vec![PathSegment::Index(1), PathSegment::Key("name".into())]);
        assert_eq!(d.get_value(&name).unwrap(), serde_json::json!("grace"));
        assert_eq!(d.get_slice(&Path::root(), 0..10).unwrap().len(), 2);
        assert_eq!(d.get_rows(&Path::root(), 1..2).unwrap().len(), 1);
        let opts = SearchOptions {
            query: "grace".into(),
            case_sensitive: false,
            max_results: None,
        };
        let never = crate::doc::jobs::CancelFlag::never();
        let hits = d.search(&opts, &never, &mut |_, _| {}).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, name);
    }

    #[test]
    fn a_mapped_document_refuses_every_whole_file_action() {
        let (_file, mut d) = mapped_doc("rows.json", ROWS);
        let never = crate::doc::jobs::CancelFlag::never();
        let limit_of = |r: DocResult<()>| match r {
            Err(DocError::TooLarge { limit, .. }) => limit,
            other => panic!("expected TooLarge, got {other:?}"),
        };
        let out = temp_path("mapped-out.json");
        let whole = [
            limit_of(d.check_editable()),
            limit_of(d.get_value(&Path::root()).map(drop)),
            limit_of(d.export(ExportFormat::Yaml).map(drop)),
            limit_of(d.canonical_lines().map(drop)),
            limit_of(d.validate_schema("{}", &never).map(drop)),
        ];
        assert_eq!(whole, [EDIT_SIZE_LIMIT; 5]);
        let in_memory = [
            limit_of(d.serialize().map(drop)),
            limit_of(d.prepare_save(Some(out.clone())).map(drop)),
            limit_of(d.export_to_file(ExportFormat::Json, &out)),
            limit_of(
                d.get_rows_sorted(&Path::root(), "id", false, 0..1)
                    .map(drop),
            ),
            limit_of(
                d.get_rows_filtered(&Path::root(), &[], Some("a"), &[], None, 0..1, &never)
                    .map(drop),
            ),
            limit_of(d.column_values(&Path::root(), "id", 10).map(drop)),
            limit_of(d.generate_types(TypegenLang::Typescript, "Root").map(drop)),
        ];
        assert_eq!(in_memory, [MAPPED_THRESHOLD_BYTES; 7]);
        assert!(d.apply(&set_a(1)).is_err());
        assert!(!std::path::Path::new(&out).exists());
        assert_eq!(d.version, 0);
    }

    #[test]
    fn a_mapped_document_skips_a_byte_order_mark_without_copying() {
        let (file, d) = mapped_doc("bom.json", &format!("\u{feff}{ROWS}"));
        let DocumentImpl::Lazy(lazy) = &d.inner else {
            panic!("expected the lazy backend");
        };
        let on_disk = std::fs::read(&file.0).unwrap();
        assert_eq!(lazy.source().as_bytes(), &on_disk[3..]);
        assert_eq!(
            d.summary().recovery_note.as_deref(),
            Some(format::LEADING_JUNK_NOTE)
        );
        assert_eq!(d.summary().source_size, ROWS.len() as u64);
    }

    #[test]
    fn a_mapped_document_refuses_what_would_need_a_copy_and_names_the_file() {
        for (name, text, want) in [
            (
                "dupes.json",
                r#"{"a": 1, "a": 2}"#,
                BigFileProblem::RepeatedKeys {
                    file: String::new(),
                },
            ),
            (
                "logs.ndjson",
                "{\"a\": 1}\n{\"a\": 2}\n",
                BigFileProblem::LinePerValue {
                    file: String::new(),
                },
            ),
        ] {
            let file = TempFile::new(name, text);
            let err = Document::from_mapped(file.map(), Some(name.into())).unwrap_err();
            let shown = file.0.to_string_lossy().into_owned();
            let want = match want {
                BigFileProblem::RepeatedKeys { .. } => BigFileProblem::RepeatedKeys { file: shown },
                _ => BigFileProblem::LinePerValue { file: shown },
            };
            assert!(
                matches!(&err, DocError::BigFile(p) if *p == want),
                "{name}: {err:?}"
            );
        }
    }

    #[test]
    fn a_mapped_document_notices_when_its_file_changes_size() {
        let (file, d) = mapped_doc("grow.json", ROWS);
        assert!(d.check_source().is_ok());
        std::fs::OpenOptions::new()
            .append(true)
            .open(&file.0)
            .and_then(|mut f| std::io::Write::write_all(&mut f, b"\n"))
            .unwrap();
        let err = d.check_source().unwrap_err();
        assert!(
            matches!(
                &err,
                DocError::BigFile(BigFileProblem::ChangedOnDisk { .. })
            ),
            "{err:?}"
        );
    }

    #[test]
    fn json_schema_types_refuse_a_document_over_the_whole_document_limit() {
        let big = doc(&format!("[{}0]", " ".repeat(EDIT_SIZE_LIMIT as usize)));
        match big.generate_types(TypegenLang::JsonSchema, "Root") {
            Err(DocError::TooLarge { limit, .. }) => assert_eq!(limit, EDIT_SIZE_LIMIT),
            other => panic!("expected TooLarge, got {:?}", other.map(|s| s.len())),
        }
        assert!(big.generate_types(TypegenLang::Typescript, "Root").is_ok());
        assert!(doc("[1, 2]")
            .generate_types(TypegenLang::JsonSchema, "Root")
            .unwrap()
            .contains("2020-12"));
    }

    fn temp_path(name: &str) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("pandia-{}-{name}", std::process::id()));
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn opens_ndjson_as_an_array() {
        let d = doc("{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n");
        let s = d.summary();
        assert_eq!(s.root_kind, NodeKind::Array);
        assert_eq!(s.root_child_count, Some(3));
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!([{"a": 1}, {"a": 2}, {"a": 3}])
        );
    }

    #[test]
    fn opens_jsonc_with_comments_and_trailing_commas() {
        let d = doc("{\n  // count\n  \"a\": 1,\n  \"b\": [2, 3,],\n}");
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"a": 1, "b": [2, 3]})
        );
    }

    #[test]
    fn jsonc_open_flags_comment_loss_until_first_save() {
        let path = temp_path("comments.jsonc");
        std::fs::write(&path, "{\n  // keep me\n  \"a\": 1,\n}").unwrap();
        let mut d = Document::from_file(&path).unwrap();
        let s = d.summary();
        assert!(s.comments_stripped);
        assert!(s.recovery_note.is_some());

        d.apply(&Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(2),
        })
        .unwrap();
        d.save(None).unwrap();
        assert!(!d.summary().comments_stripped);
        assert!(serde_json::from_str::<Value>(&std::fs::read_to_string(&path).unwrap()).is_ok());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn plain_json_never_flags_comment_loss() {
        assert!(!doc(r#"{"a": 1}"#).summary().comments_stripped);
        assert!(!doc("{\"a\":1}\n{\"a\":2}\n").summary().comments_stripped);
    }

    #[test]
    fn opens_json5() {
        let d = doc("{unquoted: 'single', hex: 0xFF, trailing: .5,}");
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"unquoted": "single", "hex": 255, "trailing": 0.5})
        );
    }

    #[test]
    fn opens_ndjson_and_jsonc_from_disk() {
        for (name, body, want) in [
            (
                "open.ndjson",
                "{\"a\":1}\n{\"a\":2}\n",
                serde_json::json!([{"a": 1}, {"a": 2}]),
            ),
            (
                "open.jsonc",
                "/* header */\n{\"a\": 1} // tail",
                serde_json::json!({"a": 1}),
            ),
            (
                "open.json5",
                "{a: +1, b: Infinity}",
                serde_json::json!({"a": 1, "b": null}),
            ),
        ] {
            let path = temp_path(name);
            std::fs::write(&path, body).unwrap();
            let d = Document::from_file(&path).expect(name);
            assert_eq!(d.get_value(&Path::root()).unwrap(), want, "{name}");
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn ndjson_still_reports_the_strict_error_when_truly_broken() {
        let err = Document::from_text("{\"a\":1}\n{\"a\":\n", None).unwrap_err();
        let DocError::Parse(msg) = err else {
            panic!("expected a parse error");
        };
        assert!(msg.contains("line 2"), "{msg}");
    }

    #[test]
    fn ndjson_extension_round_trips_through_save() {
        let path = temp_path("roundtrip.ndjson");
        std::fs::write(&path, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let mut d = Document::from_file(&path).unwrap();

        d.apply(&Op::SetValue {
            path: Path(vec![PathSegment::Index(0), PathSegment::Key("a".into())]),
            value: serde_json::json!(9),
        })
        .unwrap();
        d.save(None).unwrap();

        let written = std::fs::read_to_string(&path).unwrap();
        assert_eq!(written, "{\"a\":9}\n{\"a\":2}\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unedited_ndjson_saves_compact_records_with_their_tokens_as_written() {
        let path = temp_path("verbatim.ndjson");
        let mut body = String::new();
        let mut want = String::new();
        while body.len() < 11 * 1024 * 1024 {
            body.push_str("{\"id\": 12345678901234567890, \"pad\": \"");
            body.push_str(&"x".repeat(200));
            body.push_str("\"}\n");
            want.push_str("{\"id\":12345678901234567890,\"pad\":\"");
            want.push_str(&"x".repeat(200));
            want.push_str("\"}\n");
        }
        let lines = body.lines().count();
        std::fs::write(&path, &body).unwrap();

        let mut d = Document::from_file(&path).unwrap();
        assert!(d.summary().lazy, "large NDJSON should be lazy");
        assert_eq!(d.summary().root_child_count, Some(lines as u32));

        let out = temp_path("verbatim-out.ndjson");
        d.save(Some(out.clone())).unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), want);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn save_as_json_converts_ndjson_to_an_array() {
        let src = temp_path("convert.ndjson");
        std::fs::write(&src, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let mut d = Document::from_file(&src).unwrap();

        let dst = temp_path("convert.json");
        d.save(Some(dst.clone())).unwrap();

        let written = std::fs::read_to_string(&dst).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&written).unwrap(),
            serde_json::json!([{"a": 1}, {"a": 2}])
        );
        assert!(
            written.contains('\n') && written.starts_with('['),
            "{written}"
        );

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&dst);
    }

    #[test]
    fn ndjson_save_falls_back_to_json_when_the_root_stops_being_an_array() {
        let path = temp_path("rerooted.ndjson");
        std::fs::write(&path, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let mut d = Document::from_file(&path).unwrap();

        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({"a": 1}),
        })
        .unwrap();
        d.save(None).unwrap();

        let written = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&written).unwrap(),
            serde_json::json!({"a": 1})
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn undo_to_a_saved_state_clears_dirty_for_every_dialect() {
        for (name, body) in [
            ("undo.json", r#"{"a": 1}"#),
            ("undo.ndjson", "{\"a\":1}\n{\"a\":2}\n"),
        ] {
            let path = temp_path(name);
            std::fs::write(&path, body).unwrap();
            let mut d = Document::from_file(&path).unwrap();

            d.apply(&Op::SetValue {
                path: Path::root(),
                value: serde_json::json!({"edited": true}),
            })
            .unwrap();
            d.save(None).unwrap();
            assert!(!d.summary().dirty, "{name}: clean right after save");

            d.apply(&Op::SetValue {
                path: Path::root(),
                value: serde_json::json!({"edited": false}),
            })
            .unwrap();
            assert!(d.summary().dirty, "{name}: dirty after a fresh edit");

            d.undo().unwrap();
            assert!(
                !d.summary().dirty,
                "{name}: undo back to the saved content is not dirty"
            );

            let _ = std::fs::remove_file(&path);
        }
    }

    fn large_doc_file(name: &str) -> (String, Document) {
        let path = temp_path(name);
        let pad = "x".repeat(LAZY_THRESHOLD_BYTES as usize);
        std::fs::write(&path, format!(r#"{{"pad": "{pad}", "a": 1}}"#)).unwrap();
        let d = Document::from_file(&path).unwrap();
        assert!(d.summary().lazy);
        (path, d)
    }

    fn set_a(v: i64) -> Op {
        Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(v),
        }
    }

    #[test]
    fn undo_to_the_saved_state_clears_dirty_on_a_large_doc() {
        let (path, mut d) = large_doc_file("large-undo.json");

        d.apply(&set_a(2)).unwrap();
        d.undo().unwrap();
        assert!(!d.summary().dirty, "undo back to the opened content");

        d.apply(&set_a(3)).unwrap();
        d.save(None).unwrap();
        d.apply(&set_a(4)).unwrap();
        d.undo().unwrap();
        assert!(!d.summary().dirty, "undo back to the saved content");
        d.undo().unwrap();
        assert!(d.summary().dirty, "one step before the save");
        d.redo().unwrap();
        assert!(!d.summary().dirty, "redo forward to the saved content");

        d.undo().unwrap();
        d.apply(&set_a(5)).unwrap();
        assert!(
            d.summary().dirty,
            "a new edit drops the saved state from redo"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_edit_during_a_large_save_keeps_the_doc_dirty() {
        let (path, mut d) = large_doc_file("large-race.json");
        d.apply(&set_a(2)).unwrap();

        let pending = d.prepare_save(None).unwrap();
        d.apply(&set_a(3)).unwrap();
        pending.write().unwrap();
        d.finish_save(&pending);
        assert!(d.summary().dirty, "the file has the earlier content");
        d.undo().unwrap();
        d.undo().unwrap();
        assert!(d.summary().dirty, "the opened content is no longer on disk");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_updates_source_size_to_the_written_bytes() {
        let path = temp_path("size.json");
        std::fs::write(&path, r#"{"a":1}"#).unwrap();
        let mut d = Document::from_file(&path).unwrap();

        d.save(None).unwrap();
        assert_eq!(
            d.summary().source_size,
            std::fs::metadata(&path).unwrap().len()
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_schema_ref_to_another_address_names_that_address() {
        let d = doc(r#"{"a": 1}"#);
        for uri in ["https://example.com/s.json", "file:///tmp/s.json"] {
            let err = d
                .validate_schema(
                    &format!(r#"{{"$ref": "{uri}"}}"#),
                    &crate::doc::jobs::CancelFlag::never(),
                )
                .unwrap_err();
            let wire = crate::doc::types::WireError::from(err);
            assert_eq!(wire.kind, crate::doc::types::ErrorKind::SchemaExternalRef);
            assert_eq!(wire.detail.as_deref(), Some(uri));
        }
    }

    #[test]
    fn save_copy_sends_edits_to_a_reply_file_without_adopting_it() {
        let mut d = Document::from_text(r#"{"a": 1}"#, Some("stdin".into())).unwrap();
        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 2 }),
        })
        .unwrap();
        let reply =
            std::env::temp_dir().join(format!("pandia-reply-copy-{}.json", std::process::id()));
        std::fs::write(&reply, "").unwrap();

        d.save_copy(&reply.to_string_lossy()).unwrap();
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&reply).unwrap()).unwrap();
        assert_eq!(written, serde_json::json!({ "a": 2 }));
        let s = d.summary();
        assert!(!s.dirty, "sent edits count as saved");
        assert!(!s.file_backed, "the tab stays an unsaved stdin document");
        assert_eq!(s.source_path.as_deref(), Some("stdin"));

        std::fs::remove_file(&reply).unwrap();
        assert!(
            d.save_copy(&reply.to_string_lossy()).is_err(),
            "a missing reply file is not recreated with default permissions"
        );
    }

    #[test]
    fn save_writes_edits_and_clears_dirty() {
        let mut d = doc(r#"{"a": 1}"#);
        assert!(!d.summary().dirty, "fresh doc is clean");
        assert!(!d.summary().file_backed, "text doc has no file path");

        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 2 }),
        })
        .unwrap();
        assert!(d.summary().dirty, "edited doc is dirty");

        assert!(matches!(d.save(None), Err(DocError::Edit(_))));

        let mut path = std::env::temp_dir();
        path.push(format!("pandia-save-test-{}.json", std::process::id()));
        let path_str = path.to_string_lossy().into_owned();
        let res = d.save(Some(path_str.clone())).unwrap();
        assert_eq!(res.path, path_str);

        let written = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed, serde_json::json!({ "a": 2 }));

        assert!(!d.summary().dirty, "saved doc is clean");
        assert!(d.summary().file_backed, "doc is now file-backed");
        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 3 }),
        })
        .unwrap();
        assert!(d.summary().dirty);
        d.save(None).unwrap(); // writes to remembered path
        assert!(!d.summary().dirty);

        let _ = std::fs::remove_file(&path);
    }

    const EXTREME_NUMBER_TOKENS: &[&str] = &[
        "9007199254740991",
        "9007199254740992",
        "9007199254740993",
        "12345678901234567890",
        "123456789012345678901234567890123456789012345678901234567890",
        "-98765432109876543210987654321",
        "9223372036854775807",
        "-9223372036854775808",
        "18446744073709551615",
        "3.14159265358979323846264338327950288419716939937510582097494",
        "0.30000000000000004",
        "0.000000000000000000000000000001",
        "1e308",
        "1e309",
        "5e-324",
        "1e-400",
        "1E10",
        "2.5e+7",
        "2.5e-7",
        "-0.0",
        "0",
        "1.5",
        "1.50000000000000000000",
    ];

    #[test]
    fn serialize_preserves_every_extreme_number_token() {
        let src = format!("[{}]", EXTREME_NUMBER_TOKENS.join(","));
        let d = doc(&src);
        let out = d.serialize().unwrap();
        let reparsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(serde_json::to_string(&reparsed).unwrap(), src);
    }

    #[test]
    fn integer_negative_zero_is_normalized_by_the_parser() {
        let d = doc("[-0, -0.0]");
        let out = d.serialize().unwrap();
        let reparsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(serde_json::to_string(&reparsed).unwrap(), "[0,-0.0]");
    }

    #[test]
    fn set_value_text_edit_does_not_perturb_neighbor_tokens() {
        let src = format!("[{}]", EXTREME_NUMBER_TOKENS.join(","));
        let mut d = doc(&src);
        d.apply(&Op::SetValueText {
            path: Path(vec![PathSegment::Index(20)]),
            text: "1.2345678901234567890123456789e-7".into(),
        })
        .unwrap();
        let out = d.serialize().unwrap();
        let reparsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        let expected = src.replace(",0,1.5,", ",1.2345678901234567890123456789e-7,1.5,");
        assert_eq!(serde_json::to_string(&reparsed).unwrap(), expected);
    }

    #[test]
    fn undo_back_to_saved_state_clears_dirty() {
        let mut d = doc(r#"{"a": 1}"#);
        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 2 }),
        })
        .unwrap();
        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 3 }),
        })
        .unwrap();
        assert!(d.summary().dirty);
        d.undo().unwrap();
        d.undo().unwrap();
        assert!(d.version > d.saved_version);
        assert!(
            !d.summary().dirty,
            "undo-to-original should clear dirty by content hash"
        );
    }

    #[test]
    fn small_doc_uses_eager_path() {
        let d = doc(r#"{"a": 1, "b": 2}"#);
        assert!(matches!(d.inner, DocumentImpl::Eager(_)));
        assert!(!d.summary().lazy);
    }

    #[test]
    fn doc_above_threshold_uses_lazy_path() {
        let pad: String = std::iter::repeat('x').take(11 * 1024 * 1024).collect();
        let json = format!(r#"{{"pad": "{}"}}"#, pad);
        let d = doc(&json);
        assert!(matches!(d.inner, DocumentImpl::Lazy(_)));
        let s = d.summary();
        assert!(s.lazy);
        assert_eq!(s.root_kind, NodeKind::Object);
    }

    #[test]
    fn a_lazy_doc_keeps_the_text_it_was_given_rather_than_a_copy() {
        let pad = "x".repeat(11 * 1024 * 1024);
        let text = FastStr::from_string(format!(r#"{{"pad": "{pad}"}}"#));
        let d = Document::from_source(text.clone(), None).unwrap();
        let DocumentImpl::Lazy(lazy) = &d.inner else {
            panic!("expected the lazy backend");
        };
        assert_eq!(lazy.source().as_ptr(), text.as_ptr());
    }

    fn nested_doc(depth: usize, pad: usize) -> String {
        format!(
            r#"{{"pad":"{}","n":{}{{"leaf":"stale","leaf":"needle"}}{}"#,
            "x".repeat(pad),
            r#"{"n":"#.repeat(depth - 2),
            "}".repeat(depth - 1)
        )
    }

    #[test]
    fn a_thousand_deep_doc_works_on_a_worker_sized_stack() {
        let stack = if cfg!(debug_assertions) { 256 } else { 2 } * 1024 * 1024;
        std::thread::Builder::new()
            .stack_size(stack)
            .spawn(|| {
                for pad in [0, 11 * 1024 * 1024] {
                    let mut d = doc(&nested_doc(1000, pad));
                    assert_eq!(d.summary().lazy, pad > 0);
                    let opts = SearchOptions {
                        query: "needle".into(),
                        case_sensitive: true,
                        max_results: None,
                    };
                    let never = crate::doc::jobs::CancelFlag::never();
                    assert_eq!(d.search(&opts, &never, &mut |_, _| {}).unwrap().len(), 1);
                    d.generate_types(TypegenLang::Typescript, "Root").unwrap();

                    let mut leaf = Path(vec![PathSegment::Key("n".into()); 999]);
                    leaf.push(PathSegment::Key("leaf".into()));
                    d.apply(&Op::SetValue {
                        path: leaf.clone(),
                        value: serde_json::json!("edited"),
                    })
                    .unwrap();
                    assert_eq!(d.get_value(&leaf).unwrap(), serde_json::json!("edited"));
                    drop(d);

                    let err = Document::from_text(&nested_doc(1001, pad), None).unwrap_err();
                    assert!(matches!(err, DocError::TooDeep { limit: 1000 }), "{err:?}");
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }

    #[test]
    fn child_count_at_root_counts_every_key_of_a_lazy_object() {
        let pad = "x".repeat(100);
        let keys = 120_000;
        let body: Vec<String> = (0..keys).map(|i| format!(r#""k{i}": "{pad}""#)).collect();
        let d = doc(&format!("{{{}}}", body.join(",")));
        assert!(d.summary().lazy);
        assert_eq!(d.child_count_at(&Path::root()).unwrap(), Some(keys));
    }

    #[test]
    fn invalid_lazy_doc_returns_parse_error() {
        let pad: String = std::iter::repeat('x').take(11 * 1024 * 1024).collect();
        let bad = format!(r#"{{"pad": "{}"#, pad);
        let err = Document::from_text(&bad, None).unwrap_err();
        assert!(matches!(err, DocError::Parse(_)));
    }

    #[test]
    fn large_jsonc_doc_recovers_onto_the_lazy_path() {
        let pad = "x".repeat(11 * 1024 * 1024);
        let text = format!("// header\n{{\"pad\": \"{pad}\",}}");
        let d = doc(&text);
        assert!(d.summary().lazy);
        assert_eq!(d.summary().root_kind, NodeKind::Object);
    }

    #[test]
    fn summary_reports_root_shape_and_size() {
        let d = doc(r#"{"a": 1, "b": 2}"#);
        let s = d.summary();
        assert_eq!(s.root_kind, NodeKind::Object);
        assert_eq!(s.root_child_count, Some(2));
        assert_eq!(s.source_size, 16);
        assert!(!s.lazy);
        assert_eq!(s.version, 0);
    }

    #[test]
    fn slice_object_preserves_insertion_order() {
        let d = doc(r#"{"zeta": 1, "alpha": 2, "mu": 3}"#);
        let slice = d.get_slice(&Path::root(), 0..10).unwrap();
        let keys: Vec<_> = slice
            .iter()
            .map(|nv| match &nv.key {
                PathSegment::Key(k) => k.clone(),
                _ => panic!("expected key segment"),
            })
            .collect();
        assert_eq!(keys, vec!["zeta", "alpha", "mu"]);
    }

    #[test]
    fn slice_array_indexes_match_positions() {
        let d = doc(r#"["a", "b", "c", "d"]"#);
        let slice = d.get_slice(&Path::root(), 1..3).unwrap();
        assert_eq!(slice.len(), 2);
        assert_eq!(slice[0].key, PathSegment::Index(1));
        assert_eq!(slice[1].key, PathSegment::Index(2));
    }

    #[test]
    fn slice_clamps_overrun_range() {
        let d = doc(r#"[1, 2, 3]"#);
        let slice = d.get_slice(&Path::root(), 1..100).unwrap();
        assert_eq!(slice.len(), 2);
    }

    #[test]
    fn slice_empty_when_start_past_end() {
        let d = doc(r#"[1, 2, 3]"#);
        let slice = d.get_slice(&Path::root(), 10..20).unwrap();
        assert!(slice.is_empty());
    }

    #[test]
    fn slice_on_primitive_is_empty() {
        let d = doc(r#"42"#);
        let slice = d.get_slice(&Path::root(), 0..10).unwrap();
        assert!(slice.is_empty());
    }

    #[test]
    fn slice_invalid_path_returns_error() {
        let d = doc(r#"{"a": 1}"#);
        let bad = Path(vec![PathSegment::Key("missing".into())]);
        let err = d.get_slice(&bad, 0..10).unwrap_err();
        assert!(matches!(err, DocError::InvalidPath(_)));
    }

    #[test]
    fn nested_slice_walks_path() {
        let d = doc(r#"{"events": [{"id": 1}, {"id": 2}]}"#);
        let p = Path(vec![
            PathSegment::Key("events".into()),
            PathSegment::Index(1),
        ]);
        let slice = d.get_slice(&p, 0..10).unwrap();
        assert_eq!(slice.len(), 1);
        assert_eq!(slice[0].key, PathSegment::Key("id".into()));
        assert_eq!(slice[0].kind, NodeKind::Number);
    }

    #[test]
    fn get_value_returns_clone_of_subtree() {
        let d = doc(r#"{"a": {"b": 42}}"#);
        let p = Path(vec![PathSegment::Key("a".into())]);
        let v = d.get_value(&p).unwrap();
        assert_eq!(v, serde_json::json!({"b": 42}));
    }

    #[test]
    fn get_value_root_rejected_when_too_large() {
        let mut d = doc(r#"{"a": 1}"#);
        d.source_size = 210 * 1024 * 1024;
        let err = d.get_value(&Path::root()).unwrap_err();
        assert!(matches!(err, DocError::TooLarge { .. }));
        let p = Path(vec![PathSegment::Key("a".into())]);
        assert_eq!(d.get_value(&p).unwrap(), serde_json::json!(1));
    }

    #[test]
    fn preview_truncates_long_strings() {
        let long: String = std::iter::repeat('x').take(1100).collect();
        let json = format!(r#"{{"k": "{}"}}"#, long);
        let d = doc(&json);
        let slice = d.get_slice(&Path::root(), 0..1).unwrap();
        assert!(slice[0].preview.ends_with("\u{2026}\""));
        assert!(slice[0].preview.chars().count() <= 1003);
    }

    #[test]
    fn preview_collections_show_counts() {
        let d = doc(r#"{"arr": [1, 2, 3], "obj": {"a": 1}, "empty_arr": [], "empty_obj": {}}"#);
        let slice = d.get_slice(&Path::root(), 0..10).unwrap();
        assert_eq!(slice[0].preview, "[3 items]");
        assert_eq!(slice[1].preview, "{1 keys}");
        assert_eq!(slice[2].preview, "[]");
        assert_eq!(slice[3].preview, "{}");
    }

    #[test]
    fn child_count_is_none_for_primitives() {
        let d = doc(r#"{"s": "x", "n": 1, "b": true, "z": null}"#);
        let slice = d.get_slice(&Path::root(), 0..10).unwrap();
        for nv in slice {
            assert!(nv.child_count.is_none(), "{:?}", nv);
        }
    }

    #[test]
    fn eager_preserves_big_number_token_in_preview() {
        let d = doc(r#"{"id": 18446744073709551615}"#);
        let slice = d.get_slice(&Path::root(), 0..1).unwrap();
        assert_eq!(slice[0].preview, "18446744073709551615");
        assert_eq!(slice[0].kind, NodeKind::Number);
    }

    #[test]
    fn get_rows_returns_array_slice_as_values() {
        let d = doc(r#"[{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]"#);
        let rows = d.get_rows(&Path::root(), 1..3).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], serde_json::json!({"id": 2}));
        assert_eq!(rows[1], serde_json::json!({"id": 3}));
    }

    #[test]
    fn get_rows_sorted_orders_by_key_with_original_index() {
        let d = doc(r#"[{"n": 3}, {"n": 1}, {"n": 2}]"#);
        let asc = d.get_rows_sorted(&Path::root(), "n", false, 0..3).unwrap();
        assert_eq!(
            asc.iter().map(|r| r.index).collect::<Vec<_>>(),
            vec![1, 2, 0]
        );
        assert_eq!(asc[0].value, serde_json::json!({"n": 1}));

        let desc = d.get_rows_sorted(&Path::root(), "n", true, 0..3).unwrap();
        assert_eq!(
            desc.iter().map(|r| r.index).collect::<Vec<_>>(),
            vec![0, 2, 1]
        );
    }

    #[test]
    fn get_rows_sorted_windows_the_sorted_order() {
        let d = doc(r#"[{"n": 3}, {"n": 1}, {"n": 2}, {"n": 0}]"#);
        let win = d.get_rows_sorted(&Path::root(), "n", false, 1..3).unwrap();
        assert_eq!(win.iter().map(|r| r.index).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn get_rows_sorted_mixed_kinds_grouped_by_kind() {
        let d = doc(r#"[{"v": "z"}, {"v": 5}, {"v": true}, {}, {"v": null}]"#);
        let asc = d.get_rows_sorted(&Path::root(), "v", false, 0..5).unwrap();
        let idx: Vec<u32> = asc.iter().map(|r| r.index).collect();
        assert_eq!(idx, vec![3, 4, 2, 1, 0]);
    }

    #[test]
    fn get_rows_clamps_range_past_end() {
        let d = doc(r#"[1, 2, 3]"#);
        let rows = d.get_rows(&Path::root(), 1..100).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], serde_json::json!(2));
    }

    #[test]
    fn get_rows_empty_when_start_past_end() {
        let d = doc(r#"[1, 2, 3]"#);
        let rows = d.get_rows(&Path::root(), 10..20).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn get_rows_empty_for_non_array_path() {
        let d = doc(r#"{"a": 1}"#);
        let rows = d.get_rows(&Path::root(), 0..10).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn get_rows_invalid_path_errors() {
        let d = doc(r#"{"a": 1}"#);
        let bad = Path(vec![PathSegment::Key("missing".into())]);
        let err = d.get_rows(&bad, 0..10).unwrap_err();
        assert!(matches!(err, DocError::InvalidPath(_)));
    }

    #[test]
    fn get_rows_works_on_lazy_root_array() {
        let mut text = String::from("[");
        for i in 0..200_000 {
            if i > 0 {
                text.push(',');
            }
            text.push_str(&format!(r#"{{"i": {i}, "p": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}}"#));
        }
        text.push(']');
        assert!(text.len() > 11 * 1024 * 1024);
        let d = doc(&text);
        assert!(d.summary().lazy);

        let rows = d.get_rows(&Path::root(), 100_000..100_005).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0]["i"], serde_json::json!(100_000));
        assert_eq!(rows[4]["i"], serde_json::json!(100_004));
    }

    #[test]
    fn grid_sees_every_row_of_a_large_nested_array_in_a_lazy_doc() {
        let row = r#"{"id": 1, "name": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}"#;
        let n = 1000;
        let text = format!(
            r#"{{"rows": [{}], "pad": "{}"}}"#,
            vec![row; n].join(","),
            "x".repeat(11 * 1024 * 1024)
        );
        assert!(n * row.len() > 64 * 1024);
        let d = doc(&text);
        assert!(d.summary().lazy);

        let rows = Path(vec![PathSegment::Key("rows".into())]);
        let schema = super::super::schema::sniff_columns(&d, &rows).unwrap();
        assert_eq!(schema.row_count, n as u32);
        assert!(schema.grid_suitable);
        assert_eq!(d.get_rows(&rows, 0..3).unwrap().len(), 3);
    }

    #[test]
    #[ignore = "perf probe; run with --release --ignored"]
    fn perf_grid_on_a_large_nested_array() {
        use std::fmt::Write;
        use std::time::Instant;
        let n = 500_000u32;
        let note = "x".repeat(120);
        let mut text = String::from(r#"{"meta":{"v":1},"rows":["#);
        for i in 0..n {
            if i > 0 {
                text.push(',');
            }
            write!(
                text,
                r#"{{"id":{i},"name":"user {i}","score":{i}.5,"active":true,"tags":["a","b"],"note":"{note}"}}"#
            )
            .unwrap();
        }
        text.push_str("]}");
        let d = doc(&text);
        eprintln!(
            "[perf] {} MB, lazy={}",
            text.len() / 1_000_000,
            d.summary().lazy
        );
        let rows = Path(vec![PathSegment::Key("rows".into())]);

        let t = Instant::now();
        assert!(
            super::super::schema::sniff_columns(&d, &rows)
                .unwrap()
                .grid_suitable
        );
        eprintln!("[perf] sniff columns: {:?}", t.elapsed());
        for range in [0..100, 250_000..250_100, n - 100..n] {
            let t = Instant::now();
            assert_eq!(d.get_rows(&rows, range.clone()).unwrap().len(), 100);
            eprintln!("[perf] rows {range:?}: {:?}", t.elapsed());
        }
    }

    #[test]
    fn apply_set_value_bumps_version_and_returns_inverse() {
        let mut d = doc(r#"{"a": 1}"#);
        assert_eq!(d.version, 0);
        let op = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(99),
        };
        let result = d.apply(&op).unwrap();
        assert_eq!(result.version, 1);
        assert_eq!(d.version, 1);
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"a": 99})
        );
        assert_eq!(result.affected_paths.len(), 1);

        d.undo().unwrap().expect("undo available");
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"a": 1})
        );
    }

    #[test]
    fn apply_then_inverse_returns_to_initial() {
        let mut d = doc(r#"{"events": [10, 20, 30]}"#);
        let initial = d.get_value(&Path::root()).unwrap();
        let op = super::super::ops::Op::DeleteItem {
            path: Path(vec![PathSegment::Key("events".into())]),
            index: 1,
        };
        d.apply(&op).unwrap();
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"events": [10, 30]})
        );
        d.undo().unwrap().expect("undo available");
        assert_eq!(d.get_value(&Path::root()).unwrap(), initial);
        assert_eq!(d.version, 2);
    }

    #[test]
    fn a_lone_surrogate_is_refused_at_open_with_one_error_at_every_size() {
        let open = |pad: usize| {
            let json = format!(r#"{{"emoji": "\ud83d", "pad": "{}"}}"#, "x".repeat(pad));
            Document::from_text(&json, None).unwrap_err().to_string()
        };
        assert_eq!(open(11 * 1024 * 1024), open(1));
    }

    #[test]
    fn apply_on_lazy_doc_materializes_to_eager() {
        let pad: String = std::iter::repeat('x').take(11 * 1024 * 1024).collect();
        let json = format!(r#"{{"pad": "{}"}}"#, pad);
        let mut d = doc(&json);
        assert!(matches!(d.inner, DocumentImpl::Lazy(_)));

        let op = super::super::ops::Op::InsertKey {
            path: Path::root(),
            key: "added".into(),
            value: serde_json::json!(true),
            position: None,
        };
        d.apply(&op).unwrap();

        assert!(matches!(d.inner, DocumentImpl::Eager(_)));
        assert_eq!(
            d.get_value(&Path(vec![PathSegment::Key("added".into())]))
                .unwrap(),
            serde_json::json!(true)
        );
        assert!(!d.summary().lazy);
    }

    #[test]
    fn apply_rejects_when_doc_exceeds_edit_size_limit() {
        let mut d = doc(r#"{"a": 1}"#);
        d.source_size = 210 * 1024 * 1024;
        let pad: String = std::iter::repeat('x').take(11 * 1024 * 1024).collect();
        let json = format!(r#"{{"pad": "{}"}}"#, pad);
        let mut big = doc(&json);
        big.source_size = 210 * 1024 * 1024;
        assert!(matches!(big.inner, DocumentImpl::Lazy(_)));

        let op = super::super::ops::Op::SetValue {
            path: Path::root(),
            value: serde_json::json!(0),
        };
        assert!(matches!(
            big.check_editable(),
            Err(DocError::TooLarge { .. })
        ));
        let err = big.apply(&op).unwrap_err();
        assert!(matches!(err, DocError::TooLarge { .. }));
        assert!(matches!(big.inner, DocumentImpl::Lazy(_)));
        assert!(doc(r#"{"a": 1}"#).check_editable().is_ok());
        assert_eq!(big.version, 0);
        let _ = d;
    }

    #[test]
    fn apply_failure_leaves_doc_unchanged() {
        let mut d = doc(r#"{"a": 1}"#);
        let op = super::super::ops::Op::DeleteKey {
            path: Path::root(),
            key: "missing".into(),
        };
        let err = d.apply(&op).unwrap_err();
        assert!(matches!(err, DocError::Edit(_)));
        assert_eq!(d.version, 0);
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"a": 1})
        );
    }

    #[test]
    fn apply_records_in_history() {
        let mut d = doc(r#"{"a": 1}"#);
        let op = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(99),
        };
        d.apply(&op).unwrap();
        assert_eq!(d.history_lens(), (1, 0));
    }

    #[test]
    fn apply_then_undo_returns_to_initial_state() {
        let mut d = doc(r#"{"a": 1, "b": 2}"#);
        let initial = d.get_value(&Path::root()).unwrap();
        let op = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(99),
        };
        d.apply(&op).unwrap();
        d.undo().unwrap().expect("undo yields a result");
        assert_eq!(d.get_value(&Path::root()).unwrap(), initial);
        assert_eq!(d.history_lens(), (0, 1));
    }

    #[test]
    fn apply_then_undo_then_redo_returns_to_post_apply_state() {
        let mut d = doc(r#"{"a": 1}"#);
        let op = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(99),
        };
        d.apply(&op).unwrap();
        let post_apply = d.get_value(&Path::root()).unwrap();
        d.undo().unwrap().expect("undo yields");
        d.redo().unwrap().expect("redo yields");
        assert_eq!(d.get_value(&Path::root()).unwrap(), post_apply);
        assert_eq!(d.history_lens(), (1, 0));
    }

    #[test]
    fn new_apply_clears_redo_stack() {
        let mut d = doc(r#"{"a": 1}"#);
        let op_a = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(2),
        };
        d.apply(&op_a).unwrap();
        d.undo().unwrap().expect("undo yields");
        assert_eq!(d.history_lens(), (0, 1));

        let op_b = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(3),
        };
        d.apply(&op_b).unwrap();
        assert_eq!(d.history_lens(), (1, 0));
    }

    #[test]
    fn undo_on_empty_history_returns_none() {
        let mut d = doc(r#"{"a": 1}"#);
        assert!(d.undo().unwrap().is_none());
    }

    #[test]
    fn redo_on_empty_stack_returns_none() {
        let mut d = doc(r#"{"a": 1}"#);
        assert!(d.redo().unwrap().is_none());
    }

    #[test]
    fn version_bumps_monotonically_through_apply_undo_redo() {
        let mut d = doc(r#"{"a": 1}"#);
        let op = super::super::ops::Op::SetValue {
            path: Path(vec![PathSegment::Key("a".into())]),
            value: serde_json::json!(2),
        };
        assert_eq!(d.version, 0);
        d.apply(&op).unwrap();
        assert_eq!(d.version, 1);
        d.undo().unwrap();
        assert_eq!(d.version, 2);
        d.redo().unwrap();
        assert_eq!(d.version, 3);
    }

    #[test]
    fn five_hundred_op_cap_evicts_oldest() {
        let mut d = doc(r#"{}"#);
        for n in 0..501 {
            let op = super::super::ops::Op::InsertKey {
                path: Path::root(),
                key: format!("k{n:04}"),
                value: serde_json::json!(n),
                position: None,
            };
            d.apply(&op).unwrap();
        }
        let (undo_len, redo_len) = d.history_lens();
        assert_eq!(undo_len, 500);
        assert_eq!(redo_len, 0);
        let summary = d.summary();
        assert_eq!(summary.root_child_count, Some(501));
    }

    #[test]
    fn random_apply_undo_sequence_matches_replay() {
        let mut seed: u64 = 0xC0FFEE_42;
        fn next(s: &mut u64) -> u64 {
            *s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            *s
        }

        let initial_text = r#"{"counter": 0, "items": []}"#;
        let mut d = doc(initial_text);
        let initial: Value = serde_json::from_str(initial_text).unwrap();

        let mut active: Vec<super::super::ops::Op> = Vec::new();
        let items_path = Path(vec![PathSegment::Key("items".into())]);

        for _ in 0..200 {
            let n = next(&mut seed) >> 32;
            let action = n % 4;

            if action == 0 && !active.is_empty() {
                d.undo()
                    .unwrap()
                    .expect("undo yields when active is non-empty");
                active.pop();
            } else {
                let value = (n >> 8) % 1000;
                let op = match (n >> 16) % 3 {
                    0 => super::super::ops::Op::InsertItem {
                        path: items_path.clone(),
                        index: 0,
                        value: serde_json::json!(value),
                    },
                    1 => super::super::ops::Op::SetValue {
                        path: Path(vec![PathSegment::Key("counter".into())]),
                        value: serde_json::json!(value),
                    },
                    _ => super::super::ops::Op::InsertKey {
                        path: Path::root(),
                        key: format!("k{}_{}", value, active.len()),
                        value: serde_json::json!(true),
                        position: None,
                    },
                };
                if d.apply(&op).is_ok() {
                    active.push(op);
                }
            }
        }

        let mut expected = initial.clone();
        for op in &active {
            op.apply(&mut expected)
                .expect("active replay should succeed");
        }
        assert_eq!(d.get_value(&Path::root()).unwrap(), expected);
    }

    #[test]
    fn get_rows_filtered_and_sorts() {
        use super::super::grid_filter::{FilterOp, GridFilter};
        let d = doc(r#"[
                {"name":"a","lang":"Sindhi","v":6.1},
                {"name":"b","lang":"English","v":2.0},
                {"name":"c","lang":"Sindhi","v":1.0},
                {"name":"d","lang":"Sindhi","v":9.0}
            ]"#);
        let lang_sindhi = GridFilter {
            key: "lang".into(),
            op: FilterOp::Eq,
            value: Some(serde_json::json!("Sindhi")),
        };

        let r = d
            .get_rows_filtered(
                &Path::root(),
                &[vec![lang_sindhi.clone()]],
                None,
                &[],
                None,
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(r.total, 3);
        let indices: Vec<u32> = r.rows.iter().map(|x| x.index).collect();
        assert_eq!(indices, vec![0, 2, 3]);

        let r2 = d
            .get_rows_filtered(
                &Path::root(),
                &[vec![lang_sindhi.clone()]],
                None,
                &[],
                Some(("v", true)),
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(
            r2.rows.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![3, 0, 2]
        );

        let v_gt5 = GridFilter {
            key: "v".into(),
            op: FilterOp::Gt,
            value: Some(serde_json::json!(5)),
        };
        let r3 = d
            .get_rows_filtered(
                &Path::root(),
                &[vec![lang_sindhi.clone(), v_gt5.clone()]],
                None,
                &[],
                Some(("v", false)),
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(r3.total, 2);
        assert_eq!(
            r3.rows.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![0, 3]
        );

        let lang_english = GridFilter {
            key: "lang".into(),
            op: FilterOp::Eq,
            value: Some(serde_json::json!("English")),
        };
        let r4 = d
            .get_rows_filtered(
                &Path::root(),
                &[vec![lang_english], vec![v_gt5]],
                None,
                &[],
                None,
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(r4.total, 3);
        assert_eq!(
            r4.rows.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![0, 1, 3]
        );
    }

    #[test]
    fn quick_filter_prefix_narrows_against_cached_perm() {
        let d = doc(r#"[
                {"name":"item"},
                {"name":"item-0"},
                {"name":"item-1"},
                {"name":"item-101"},
                {"name":"other"}
            ]"#);
        let qk = vec!["name".to_string()];
        let r1 = d
            .get_rows_filtered(
                &Path::root(),
                &[],
                Some("item"),
                &qk,
                None,
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(r1.total, 4);

        let r2 = d
            .get_rows_filtered(
                &Path::root(),
                &[],
                Some("item-1"),
                &qk,
                None,
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(
            r2.rows.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    #[test]
    fn quick_filter_returns_cancelled_when_flag_set() {
        let body: String = (0..20_000)
            .map(|i| format!(r#"{{"name":"row-{i}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let d = doc(&format!("[{body}]"));
        let qk = vec!["name".to_string()];
        let cancel = crate::doc::jobs::CancelFlag::default();
        cancel.cancel();
        let err = d
            .get_rows_filtered(&Path::root(), &[], Some("row"), &qk, None, 0..100, &cancel)
            .unwrap_err();
        matches!(err, DocError::Cancelled);
    }

    #[test]
    fn grid_quick_filter_and_column_values() {
        let d = doc(r#"[
                {"name":"Ada","lang":"Sindhi"},
                {"name":"Bo","lang":"English"},
                {"name":"Cy","lang":"Sindhi"},
                {"name":"Ada Two","lang":"Urdu"}
            ]"#);
        let quick_keys = vec!["name".to_string(), "lang".to_string()];
        let r = d
            .get_rows_filtered(
                &Path::root(),
                &[],
                Some("ada"),
                &quick_keys,
                None,
                0..100,
                &crate::doc::jobs::CancelFlag::never(),
            )
            .unwrap();
        assert_eq!(
            r.rows.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![0, 3]
        );

        let cv = d.column_values(&Path::root(), "lang", 100).unwrap();
        assert!(!cv.capped);
        assert_eq!(cv.values.len(), 3);
        assert_eq!(cv.values[0].value.as_str(), "\"Sindhi\"");
        assert_eq!(cv.values[0].count, 2);
    }

    #[test]
    fn grid_text_filters_ignore_case_the_way_find_does_on_both_backends() {
        use super::super::grid_filter::{FilterOp, GridFilter};
        let rows = r#"[{"t":"ΣΑΣΑ ΟΔΟΣΑ"},{"t":"other"},{"t":"ΟΔΟΣΑ"}]"#;
        let padded = format!("{rows}{}", " ".repeat(LAZY_THRESHOLD_BYTES as usize));
        let never = crate::doc::jobs::CancelFlag::never();
        for (lazy, d) in [(false, doc(rows)), (true, doc(&padded))] {
            assert_eq!(d.summary().lazy, lazy);
            let find = SearchOptions {
                query: "ΟΔΟΣ".into(),
                case_sensitive: false,
                max_results: None,
            };
            let hits = d.search(&find, &never, &mut |_, _| {}).unwrap();
            assert_eq!(hits.len(), 2, "lazy={lazy}");

            let shown = |groups: &[Vec<GridFilter>], quick: Option<&str>| -> Vec<u32> {
                let quick_keys = ["t".to_string()];
                let r = d.get_rows_filtered(
                    &Path::root(),
                    groups,
                    quick,
                    &quick_keys,
                    None,
                    0..10,
                    &never,
                );
                r.unwrap().rows.iter().map(|x| x.index).collect()
            };
            let text = |op| {
                vec![vec![GridFilter {
                    key: "t".into(),
                    op,
                    value: Some(serde_json::json!("ΟΔΟΣ")),
                }]]
            };
            assert_eq!(shown(&[], Some("ΟΔΟΣ")), [0, 2], "lazy={lazy}");
            assert_eq!(
                shown(&text(FilterOp::Contains), None),
                [0, 2],
                "lazy={lazy}"
            );
            assert_eq!(
                shown(&text(FilterOp::NotContains), None),
                [1],
                "lazy={lazy}"
            );
            assert_eq!(shown(&text(FilterOp::StartsWith), None), [2], "lazy={lazy}");
        }
    }

    fn grid_docs() -> [(bool, Document); 2] {
        let rows = format!(
            "[{}]",
            (0..40)
                .map(|i| format!(r#"{{"name":"row-{i}","v":{}}}"#, (i * 7) % 13))
                .collect::<Vec<_>>()
                .join(",")
        );
        let padded = format!("{rows}{}", " ".repeat(LAZY_THRESHOLD_BYTES as usize));
        [(false, doc(&rows)), (true, doc(&padded))]
    }

    #[test]
    fn row_indices_match_the_filtered_rows_on_both_backends() {
        use super::super::grid_filter::{FilterOp, GridFilter};
        let never = crate::doc::jobs::CancelFlag::never();
        let groups = [vec![GridFilter {
            key: "v".into(),
            op: FilterOp::Gt,
            value: Some(serde_json::json!(3)),
        }]];
        let quick_keys = ["name".to_string()];
        let sort = Some(("v", true));
        for (lazy, d) in grid_docs() {
            assert_eq!(d.summary().lazy, lazy);
            let indices = d
                .get_row_indices(
                    &Path::root(),
                    &groups,
                    Some("row-1"),
                    &quick_keys,
                    sort,
                    2..9,
                )
                .unwrap();
            let rows = d
                .get_rows_filtered(
                    &Path::root(),
                    &groups,
                    Some("row-1"),
                    &quick_keys,
                    sort,
                    2..9,
                    &never,
                )
                .unwrap();
            let shown: Vec<u32> = rows.rows.iter().map(|r| r.index).collect();
            assert_eq!(indices, shown, "lazy={lazy}");
            assert_eq!(indices, [16, 1, 14, 12, 10], "lazy={lazy}");
        }
    }

    #[test]
    fn row_indices_without_a_filter_match_the_sorted_and_plain_rows_on_both_backends() {
        for (lazy, d) in grid_docs() {
            let indices = d
                .get_row_indices(&Path::root(), &[], None, &[], Some(("v", false)), 5..12)
                .unwrap();
            let rows = d.get_rows_sorted(&Path::root(), "v", false, 5..12).unwrap();
            let shown: Vec<u32> = rows.iter().map(|r| r.index).collect();
            assert_eq!(indices, shown, "lazy={lazy}");
            assert_eq!(
                d.get_row_indices(&Path::root(), &[], None, &[], None, 38..50)
                    .unwrap(),
                [38, 39],
                "lazy={lazy}"
            );
        }
    }

    #[test]
    fn get_rows_at_fetches_in_order() {
        let d = doc(r#"[{"n":0},{"n":1},{"n":2},{"n":3}]"#);
        let vals = d.get_rows_at(&Path::root(), &[3, 0, 2]).unwrap();
        assert_eq!(
            vals,
            vec![
                serde_json::json!({"n":3}),
                serde_json::json!({"n":0}),
                serde_json::json!({"n":2}),
            ]
        );
        assert!(d.get_rows_at(&Path::root(), &[]).unwrap().is_empty());
    }

    #[test]
    fn get_rows_at_serialized_preserves_big_integers() {
        let d = doc(r#"[{"id": 123456789012345678}, {"id": 2}]"#);
        let vals = d.get_rows_at(&Path::root(), &[0]).unwrap();
        let json = serde_json::to_string_pretty(&vals).unwrap();
        assert!(
            json.contains("123456789012345678"),
            "big integer kept as a literal, got: {json}"
        );
        assert!(!json.contains("123456789012345680"), "not rounded to f64");
    }

    #[test]
    fn get_column_plucks_key_and_skips_items_without_it() {
        let d = doc(r#"[
                {"info": {"name": "Linh"}},
                {"other": 1},
                42,
                {"info": null},
                {"info": {"name": "David"}}
            ]"#);
        let vals = d.get_column(&Path::root(), "info").unwrap();
        assert_eq!(
            vals,
            vec![
                serde_json::json!({"name": "Linh"}),
                serde_json::Value::Null,
                serde_json::json!({"name": "David"}),
            ]
        );
    }

    #[test]
    fn file_errors_carry_operation_path_and_problem() {
        use crate::doc::types::{FileOp, IoProblem, WireError};

        let dir = std::env::temp_dir().join(format!("pandia-io-{}", std::process::id()));
        let missing = dir.join("missing.json");
        let io = WireError::from(Document::from_file(&missing).unwrap_err())
            .io
            .expect("file errors carry io context");
        assert_eq!(io.problem, IoProblem::Missing);
        assert_eq!(io.op, Some(FileOp::Open));
        assert_eq!(io.file.as_deref(), Some(missing.to_str().unwrap()));

        let target = dir.join("no-such-folder").join("out.json");
        let mut d = doc(r#"{"a":1}"#);
        let err = d
            .save(Some(target.to_string_lossy().into_owned()))
            .unwrap_err();
        let io = WireError::from(err).io.unwrap();
        assert_eq!(
            (io.problem, io.op),
            (IoProblem::Missing, Some(FileOp::Save))
        );

        std::fs::create_dir_all(&dir).unwrap();
        let binary = dir.join("binary.json");
        std::fs::write(&binary, [0xff, 0xfe, 0x00, 0x7b]).unwrap();
        let io = WireError::from(Document::from_file(&binary).unwrap_err())
            .io
            .unwrap();
        assert_eq!(
            (io.problem, io.op),
            (IoProblem::NotText, Some(FileOp::Open))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_column_root_rejected_when_too_large() {
        let mut d = doc(r#"[{"a": 1}]"#);
        d.source_size = 210 * 1024 * 1024;
        let err = d.get_column(&Path::root(), "a").unwrap_err();
        assert!(matches!(err, DocError::TooLarge { .. }));
    }

    #[test]
    fn column_values_keep_lossless_number_tokens() {
        let d = doc(r#"[
                {"id": 123456789012345678},
                {"id": 123456789012345678},
                {"id": "x"}
            ]"#);
        let cv = d.column_values(&Path::root(), "id", 100).unwrap();

        let big = cv
            .values
            .iter()
            .find(|v| v.value.as_str() == "123456789012345678")
            .expect("big-int token present and exact");
        assert_eq!(big.count, 2);

        assert!(cv.values.iter().any(|v| v.value.as_str() == "\"x\""));
    }

    #[test]
    fn replace_all_never_renames_a_key_onto_another_key() {
        for text in [r#"{"foo":1,"baz":2}"#, r#"{"baz":2,"foo":1}"#] {
            let mut d = doc(text);
            let r = d.replace_all("foo", "baz", false).unwrap();
            assert_eq!(r.count, 0, "{text}");
            let v = d.get_value(&Path::root()).unwrap();
            assert_eq!(v, serde_json::json!({"foo": 1, "baz": 2}), "{text}");
        }
    }

    #[test]
    fn replace_all_values_keys_and_undo() {
        let mut d = doc(r#"{"name":"Foo Bar","note":"foo foo","FOO":1}"#);
        let r = d.replace_all("foo", "baz", false).unwrap();
        assert_eq!(r.count, 4);
        let v = d.get_value(&Path::root()).unwrap();
        assert_eq!(v["name"], serde_json::json!("baz Bar"));
        assert_eq!(v["note"], serde_json::json!("baz baz"));
        assert_eq!(v["baz"], serde_json::json!(1)); // key "FOO" → literal replacement "baz"
        assert!(v.get("FOO").is_none());

        d.undo().unwrap();
        let back = d.get_value(&Path::root()).unwrap();
        assert_eq!(back["name"], serde_json::json!("Foo Bar"));
        assert_eq!(back["FOO"], serde_json::json!(1));

        let mut d2 = doc(r#"{"a":"Foo foo"}"#);
        let r2 = d2.replace_all("foo", "x", true).unwrap();
        assert_eq!(r2.count, 1);
        assert_eq!(
            d2.get_value(&Path::root()).unwrap()["a"],
            serde_json::json!("Foo x")
        );

        let mut d3 = doc(r#"{"a":1}"#);
        let r3 = d3.replace_all("zzz", "y", false).unwrap();
        assert_eq!(r3.count, 0);
        assert!(r3.applied.is_none());
    }

    #[test]
    fn replace_all_counts_each_changed_value_once_on_both_backends() {
        let text = r#"{"a":"foo foo foo","b":["foo","bar"],"foo":1}"#;
        let padded = format!("{text}{}", " ".repeat(LAZY_THRESHOLD_BYTES as usize));
        for (lazy, mut d) in [(false, doc(text)), (true, doc(&padded))] {
            assert_eq!(d.summary().lazy, lazy);
            let r = d.replace_all("foo", "x", false).unwrap();
            assert_eq!((r.count, r.values, r.keys), (5, 2, 1), "lazy={lazy}");
        }
    }

    #[test]
    fn a_failed_export_leaves_the_existing_file_untouched() {
        let d = doc(r#"{"not": "an array of objects"}"#);
        let path = temp_path("export-keep.csv");
        std::fs::write(&path, "id,name\n1,kept\n").unwrap();
        assert!(d.export_to_file(ExportFormat::Csv, &path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "id,name\n1,kept\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_to_file_writes_streamed_json() {
        let d = doc(r#"{"a":1,"b":[2,3]}"#);
        let p = std::env::temp_dir().join("pandia_export_to_file_test.json");
        let ps = p.to_str().unwrap();
        d.export_to_file(ExportFormat::JsonMin, ps).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), r#"{"a":1,"b":[2,3]}"#);
        d.export_to_file(ExportFormat::Json, ps).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().contains('\n')); // pretty
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn export_preview_bounds_and_flags() {
        let d = doc(r#"{"a":1}"#);
        let (text, truncated) = d.export_preview(ExportFormat::JsonMin, 1000).unwrap();
        assert!(!truncated);
        assert_eq!(text, r#"{"a":1}"#);

        let d2 = doc(r#"{"name":"abcdefghijklmnopqrstuvwxyz"}"#);
        let (t2, trunc2) = d2.export_preview(ExportFormat::JsonMin, 5).unwrap();
        assert!(trunc2);
        assert_eq!(t2.chars().count(), 5);
    }

    #[test]
    fn a_file_of_exactly_the_lazy_threshold_is_clean_after_edit_then_undo() {
        let mut text = String::from("[1, 2]");
        text.push_str(&" ".repeat(LAZY_THRESHOLD_BYTES as usize - text.len()));
        let mut d = doc(&text);
        assert!(d.summary().lazy);

        d.apply(&Op::SetValueText {
            path: Path(vec![PathSegment::Index(0)]),
            text: "5".into(),
        })
        .unwrap();
        d.undo().unwrap();

        assert!(!d.summary().dirty);
    }

    #[test]
    fn a_one_record_ndjson_file_saves_as_one_record() {
        for (name, body, edit, want) in [
            (
                "one.jsonl",
                "{\"id\":1,\"tags\":[\"a\"]}\n",
                vec![PathSegment::Index(0), PathSegment::Key("id".into())],
                "{\"id\":2,\"tags\":[\"a\"]}\n",
            ),
            (
                "one.ndjson",
                "[1,2,3]\n",
                vec![PathSegment::Index(0), PathSegment::Index(0)],
                "[2,2,3]\n",
            ),
        ] {
            let path = temp_path(name);
            std::fs::write(&path, body).unwrap();
            let mut d = Document::from_file(&path).unwrap();
            let s = d.summary();
            assert_eq!(
                (s.root_kind, s.root_child_count),
                (NodeKind::Array, Some(1)),
                "{name}"
            );

            d.apply(&Op::SetValueText {
                path: Path(edit),
                text: "2".into(),
            })
            .unwrap();
            d.save(None).unwrap();

            assert_eq!(std::fs::read_to_string(&path).unwrap(), want, "{name}");
            let _ = std::fs::remove_file(&path);
        }

        let path = temp_path("one-large.ndjson");
        let body = format!(
            "{{\"pad\":\"{}\"}}\n",
            "x".repeat(LAZY_THRESHOLD_BYTES as usize)
        );
        std::fs::write(&path, &body).unwrap();
        let mut d = Document::from_file(&path).unwrap();
        let s = d.summary();
        assert!(s.lazy);
        assert_eq!(
            (s.root_kind, s.root_child_count),
            (NodeKind::Array, Some(1))
        );
        d.save(None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_code_view_commit_keeps_integer_like_keys_where_they_were() {
        let path = temp_path("order.json");
        std::fs::write(&path, r#"{"name":"x","10":1,"2":2,"zip":"00501"}"#).unwrap();
        let mut d = Document::from_file(&path).unwrap();

        let (text, _) = d.canonical_lines().unwrap();
        d.apply(&Op::SetValueText {
            path: Path::root(),
            text: text.replace("\"x\"", "\"y\""),
        })
        .unwrap();
        d.save(None).unwrap();

        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let keys: Vec<&str> = saved
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["name", "10", "2", "zip"]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_ndjson_file_with_every_row_deleted_reopens_as_an_empty_array() {
        let path = temp_path("emptied.ndjson");
        std::fs::write(&path, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let mut d = Document::from_file(&path).unwrap();
        for _ in 0..2 {
            d.apply(&Op::DeleteItem {
                path: Path::root(),
                index: 0,
            })
            .unwrap();
        }
        d.save(None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");

        for body in ["", " \n\r\n\t"] {
            std::fs::write(&path, body).unwrap();
            let d = Document::from_file(&path).unwrap();
            assert_eq!(d.get_value(&Path::root()).unwrap(), serde_json::json!([]));
        }
        let _ = std::fs::remove_file(&path);
    }
}
