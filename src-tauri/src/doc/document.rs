
use std::collections::HashMap;
use std::ops::Range;
use std::path::Path as FsPath;
use std::sync::Arc;

use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::eager::{
    cell, cmp_cell, eager_cell_text_lower, kind_and_child_count_eager, replace_in_value,
    resolve_eager, slice_eager,
};
use super::export::{self, export as export_value, ExportFormat};
use super::grid_filter::{row_passes, GridFilter};
use super::history::History;
use super::lazy::LazyDoc;
use super::ops::{Op, OpDescription, OpOutcome};
use super::schema_validate::{
    validate as schema_validate_value, SchemaCompileError, SchemaValidationResult,
};
use super::search::{search_in_value, SearchHit, SearchOptions};
use super::typegen::{
    generate as generate_types, generate_from_shape as typegen_from_shape, TypegenLang,
};
use super::types::{DocError, DocResult, NodeKind, NodeView, Path, PathSegment};

const LAZY_THRESHOLD_BYTES: u64 = 10 * 1024 * 1024;
const GET_VALUE_ROOT_LIMIT: u64 = 200 * 1024 * 1024;
const EDIT_SIZE_LIMIT: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub version: u64,
    pub inverse: Op,
    pub affected_paths: Vec<Path>,
}

#[derive(Debug, Clone, serde::Serialize)]
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
    pub version: u64,
    pub saved_version: u64,
    saved_hash: blake3::Hash,
    hash_cache: parking_lot::Mutex<Option<(u64, blake3::Hash)>>,
    history: History,
    sort_cache: Option<SortCache>,
    filter_cache: Option<FilterCache>,
    quick_text_cache: HashMap<(Path, String), QuickTextColumn>,
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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnValue {
    pub value: Value,
    pub count: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub count: u32,
    pub applied: Option<ApplyResult>,
}

#[derive(Debug)]
enum DocumentImpl {
    Eager(Value),
    Lazy(LazyDoc),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub root_kind: NodeKind,
    pub root_child_count: Option<u32>,
    pub source_path: Option<String>,
    pub source_size: u64,
    pub lazy: bool,
    pub version: u64,
    pub dirty: bool,
    pub file_backed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub version: u64,
}

impl Document {
    pub fn from_text(text: &str, source_path: Option<String>) -> DocResult<Self> {
        let size = text.len() as u64;

        let inner = if size >= LAZY_THRESHOLD_BYTES {
            DocumentImpl::Lazy(LazyDoc::new(text)?)
        } else {
            let v: Value =
                serde_json::from_str(text).map_err(|e| DocError::Parse(e.to_string()))?;
            DocumentImpl::Eager(v)
        };

        let mut doc = Self {
            inner,
            source_path,
            file_path: None,
            source_size: size,
            version: 0,
            saved_version: 0,
            saved_hash: blake3::Hash::from_bytes([0u8; 32]),
            hash_cache: parking_lot::Mutex::new(None),
            history: History::default(),
            sort_cache: None,
            filter_cache: None,
            quick_text_cache: HashMap::new(),
        };
        doc.saved_hash = doc.compute_content_hash();
        Ok(doc)
    }

    fn compute_content_hash(&self) -> blake3::Hash {
        let mut hasher = blake3::Hasher::new();
        match &self.inner {
            DocumentImpl::Eager(v) => {
                if serde_json::to_writer_pretty(&mut hasher, v).is_err() {
                    return blake3::Hash::from_bytes([0u8; 32]);
                }
            }
            DocumentImpl::Lazy(d) => {
                hasher.update(d.source().as_bytes());
            }
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
        self.current_hash() != self.saved_hash
    }

    pub fn from_file<P: AsRef<FsPath>>(path: P) -> DocResult<Self> {
        let p = path.as_ref();
        let text = std::fs::read_to_string(p)?;
        let path_str = p.to_string_lossy().into_owned();
        let mut doc = Self::from_text(&text, Some(path_str.clone()))?;
        doc.file_path = Some(path_str);
        Ok(doc)
    }

    pub fn summary(&self) -> Summary {
        let (root_kind, root_child_count) = match &self.inner {
            DocumentImpl::Eager(v) => kind_and_child_count_eager(v),
            DocumentImpl::Lazy(d) => (d.root_kind(), d.root_child_count()),
        };
        Summary {
            root_kind,
            root_child_count,
            source_path: self.source_path.clone(),
            source_size: self.source_size,
            lazy: matches!(self.inner, DocumentImpl::Lazy(_)),
            version: self.version,
            dirty: self.is_dirty(),
            file_backed: self.file_path.is_some(),
        }
    }

    pub fn export(&self, format: ExportFormat) -> DocResult<String> {
        if self.source_size > GET_VALUE_ROOT_LIMIT {
            return Err(DocError::TooLarge {
                actual: self.source_size,
                limit: GET_VALUE_ROOT_LIMIT,
            });
        }
        let result = match &self.inner {
            DocumentImpl::Eager(v) => export_value(v, format),
            DocumentImpl::Lazy(d) => {
                let v = d.get_value(&Path::root())?;
                export_value(&v, format)
            }
        };
        result.map_err(|e| DocError::Parse(e.to_string()))
    }

    pub fn export_to_file(&self, format: ExportFormat, path: &str) -> DocResult<()> {
        let file = std::fs::File::create(path)?;
        let mut w = std::io::BufWriter::new(file);
        match format {
            ExportFormat::Json | ExportFormat::JsonMin => {
                let pretty = matches!(format, ExportFormat::Json);
                let r = match &self.inner {
                    DocumentImpl::Eager(v) => export::write_json_value(v, pretty, &mut w),
                    DocumentImpl::Lazy(d) => export::write_json_source(d.source(), pretty, &mut w),
                };
                r.map_err(|e| DocError::Parse(e.to_string()))?;
            }
            _ => {
                let full = self.export(format)?;
                std::io::Write::write_all(&mut w, full.as_bytes())?;
            }
        }
        std::io::Write::flush(&mut w)?;
        Ok(())
    }

    pub fn export_preview(
        &self,
        format: ExportFormat,
        max_chars: usize,
    ) -> DocResult<(String, bool)> {
        let max_bytes = max_chars.saturating_mul(4).max(1024);
        match format {
            ExportFormat::Json | ExportFormat::JsonMin => {
                let pretty = matches!(format, ExportFormat::Json);
                let (mut text, mut truncated) = match &self.inner {
                    DocumentImpl::Eager(v) => export::preview_json_value(v, pretty, max_bytes),
                    DocumentImpl::Lazy(d) => {
                        export::preview_json_source(d.source(), pretty, max_bytes)
                            .map_err(|e| DocError::Parse(e.to_string()))?
                    }
                };
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
        match &self.inner {
            DocumentImpl::Eager(v) => {
                serde_json::to_string_pretty(v).map_err(|e| DocError::Parse(e.to_string()))
            }
            DocumentImpl::Lazy(d) => Ok(d.source().to_string()),
        }
    }

    pub fn set_file_path(&mut self, path: String) {
        self.file_path = Some(path.clone());
        self.source_path = Some(path);
    }

    pub fn save(&mut self, path: Option<String>) -> DocResult<SaveResult> {
        let target = path
            .or_else(|| self.file_path.clone())
            .ok_or_else(|| DocError::Edit("no file path — use Save As".into()))?;
        let text = self.serialize()?;
        let new_hash = blake3::hash(text.as_bytes());
        std::fs::write(&target, text)?;
        self.file_path = Some(target.clone());
        self.source_path = Some(target.clone());
        self.saved_version = self.version;
        self.saved_hash = new_hash;
        *self.hash_cache.lock() = Some((self.version, new_hash));
        Ok(SaveResult {
            path: target,
            version: self.version,
        })
    }

    pub fn get_slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>> {
        match &self.inner {
            DocumentImpl::Eager(v) => slice_eager(v, path, range),
            DocumentImpl::Lazy(d) => d.slice(path, range),
        }
    }

    pub fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)> {
        if path.is_root() {
            let s = self.summary();
            return Ok((s.root_kind, s.root_child_count));
        }
        match &self.inner {
            DocumentImpl::Eager(v) => {
                let target = resolve_eager(v, path)?;
                Ok(kind_and_child_count_eager(target))
            }
            DocumentImpl::Lazy(d) => d.kind_at(path),
        }
    }

    pub fn get_rows(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<Value>> {
        let (kind, count) = self.kind_at(path)?;
        if kind != NodeKind::Array {
            return Ok(Vec::new());
        }
        let total = count.unwrap_or(0);
        let start = range.start.min(total);
        let end = range.end.min(total);
        if start >= end {
            return Ok(Vec::new());
        }

        let mut out = Vec::with_capacity((end - start) as usize);
        for i in start..end {
            let mut p = path.clone();
            p.push(PathSegment::Index(i));
            out.push(self.get_value(&p)?);
        }
        Ok(out)
    }

    pub fn get_rows_sorted(
        &mut self,
        path: &Path,
        key: &str,
        descending: bool,
        range: Range<u32>,
    ) -> DocResult<Vec<SortedRow>> {
        let matches = self.sort_cache.as_ref().is_some_and(|c| {
            c.path == *path
                && c.key == key
                && c.descending == descending
                && c.version == self.version
        });
        if !matches {
            let cells = self.column_cells(path, key)?;
            let mut perm: Vec<u32> = (0..cells.len() as u32).collect();
            perm.sort_by(|&a, &b| {
                let ord = cmp_cell(cells[a as usize].as_ref(), cells[b as usize].as_ref());
                if descending {
                    ord.reverse()
                } else {
                    ord
                }
            });
            self.sort_cache = Some(SortCache {
                path: path.clone(),
                key: key.to_string(),
                descending,
                version: self.version,
                perm,
            });
        }

        let perm = &self.sort_cache.as_ref().expect("just set").perm;
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
        match &self.inner {
            DocumentImpl::Eager(v) => match resolve_eager(v, path) {
                Ok(Value::Array(arr)) => Ok(arr.iter().map(|el| cell(el, key).cloned()).collect()),
                _ => Ok(Vec::new()),
            },
            DocumentImpl::Lazy(d) => d.array_field_cells(path, key),
        }
    }

    fn compute_column_text_lower(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>> {
        match &self.inner {
            DocumentImpl::Eager(v) => match resolve_eager(v, path) {
                Ok(Value::Array(arr)) => {
                    Ok(arr.iter().map(|el| eager_cell_text_lower(el, key)).collect())
                }
                _ => Ok(Vec::new()),
            },
            DocumentImpl::Lazy(d) => d.array_field_text_lower(path, key),
        }
    }

    fn quick_text_column(
        &mut self,
        path: &Path,
        key: &str,
    ) -> DocResult<Arc<Vec<Option<String>>>> {
        let cache_key = (path.clone(), key.to_string());
        if let Some(entry) = self.quick_text_cache.get(&cache_key) {
            if entry.version == self.version {
                return Ok(entry.text.clone());
            }
        }
        let text = Arc::new(self.compute_column_text_lower(path, key)?);
        self.quick_text_cache.insert(
            cache_key,
            QuickTextColumn {
                version: self.version,
                text: text.clone(),
            },
        );
        Ok(text)
    }

    pub fn get_rows_filtered(
        &mut self,
        path: &Path,
        groups: &[Vec<GridFilter>],
        quick: Option<&str>,
        quick_keys: &[String],
        sort: Option<(&str, bool)>,
        range: Range<u32>,
        cancel: &crate::doc::jobs::CancelFlag,
    ) -> DocResult<FilteredRows> {
        let sort_owned = sort.map(|(k, d)| (k.to_string(), d));
        let quick_norm = quick.map(str::trim).filter(|q| !q.is_empty());
        let quick_lower = quick_norm.map(str::to_lowercase);
        let quick_owned = quick_norm.map(str::to_string);

        let cached = self.filter_cache.as_ref().is_some_and(|c| {
            c.path == *path
                && c.groups == groups
                && c.quick.as_deref() == quick_norm
                && c.quick_keys == quick_keys
                && c.sort == sort_owned
                && c.version == self.version
        });

        if !cached {
            let mut key_cells: HashMap<String, Vec<Option<Value>>> = HashMap::new();
            for grp in groups {
                for f in grp {
                    if !key_cells.contains_key(f.key.as_str()) {
                        key_cells.insert(f.key.clone(), self.column_cells(path, &f.key)?);
                    }
                }
            }
            if let Some((sk, _)) = sort {
                if !key_cells.contains_key(sk) {
                    key_cells.insert(sk.to_string(), self.column_cells(path, sk)?);
                }
            }

            let mut quick_text: HashMap<String, Arc<Vec<Option<String>>>> = HashMap::new();
            if quick_lower.is_some() {
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

            let narrow_seed: Option<Vec<u32>> =
                self.filter_cache.as_ref().and_then(|c| {
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
                            if curr.len() > prev.len()
                                && curr.to_lowercase().starts_with(&prev.to_lowercase()) =>
                        {
                            Some(c.perm.clone())
                        }
                        _ => None,
                    }
                });

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
                let pass_filters = row_passes(groups, |k| {
                    key_cells
                        .get(k)
                        .and_then(|c| c.get(i as usize))
                        .and_then(|o| o.as_ref())
                });
                if !pass_filters {
                    continue;
                }
                let pass_quick = match &quick_lower {
                    None => true,
                    Some(q) => {
                        quick_keys.is_empty()
                            || quick_keys.iter().any(|k| {
                                quick_text
                                    .get(k)
                                    .and_then(|c| c.get(i as usize))
                                    .and_then(|o| o.as_deref())
                                    .map(|t| t.contains(q.as_str()))
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
                    let ord = cmp_cell(cells[a as usize].as_ref(), cells[b as usize].as_ref());
                    if desc {
                        ord.reverse()
                    } else {
                        ord
                    }
                });
            }

            self.filter_cache = Some(FilterCache {
                path: path.clone(),
                groups: groups.to_vec(),
                quick: quick_owned,
                quick_keys: quick_keys.to_vec(),
                sort: sort_owned,
                version: self.version,
                perm,
            });
        }

        let perm = &self.filter_cache.as_ref().expect("just set").perm;
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

    pub fn column_values(&self, path: &Path, key: &str, limit: usize) -> DocResult<ColumnValues> {
        let cells = self.column_cells(path, key)?;
        let mut map: std::collections::HashMap<String, (Value, u32)> =
            std::collections::HashMap::new();
        let mut capped = false;
        for c in cells {
            let v = c.unwrap_or(Value::Null);
            let k = v.to_string();
            if let Some(e) = map.get_mut(&k) {
                e.1 += 1;
            } else if map.len() < limit {
                map.insert(k, (v, 1));
            } else {
                capped = true;
            }
        }
        let mut values: Vec<ColumnValue> = map
            .into_values()
            .map(|(value, count)| ColumnValue { value, count })
            .collect();
        values.sort_by(|a, b| {
            b.count
                .cmp(&a.count)
                .then_with(|| cmp_cell(Some(&a.value), Some(&b.value)))
        });
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

    pub fn get_value(&self, path: &Path) -> DocResult<Value> {
        if path.is_root() && self.source_size > GET_VALUE_ROOT_LIMIT {
            return Err(DocError::TooLarge {
                actual: self.source_size,
                limit: GET_VALUE_ROOT_LIMIT,
            });
        }
        match &self.inner {
            DocumentImpl::Eager(v) => Ok(resolve_eager(v, path)?.clone()),
            DocumentImpl::Lazy(d) => d.get_value(path),
        }
    }

    pub fn apply(&mut self, op: &Op) -> DocResult<ApplyResult> {
        let result = self.apply_unchecked(op)?;
        self.history.record(op.clone(), result.inverse.clone());
        Ok(result)
    }

    fn apply_unchecked(&mut self, op: &Op) -> DocResult<ApplyResult> {
        let root = self.ensure_eager()?;
        let OpOutcome {
            inverse,
            affected_paths,
        } = op.apply(root)?;
        self.version += 1;
        Ok(ApplyResult {
            version: self.version,
            inverse,
            affected_paths,
        })
    }

    pub fn undo(&mut self) -> DocResult<Option<ApplyResult>> {
        let Some((forward, inverse)) = self.history.pop_undo() else {
            return Ok(None);
        };
        match self.apply_unchecked(&inverse) {
            Ok(result) => {
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
            Ok(result) => {
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
    ) -> DocResult<Vec<SearchHit>> {
        Ok(match &self.inner {
            DocumentImpl::Eager(v) => search_in_value(v, opts, cancel),
            DocumentImpl::Lazy(d) => d.search(opts, cancel),
        })
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
                applied: None,
            });
        }
        let re = RegexBuilder::new(&regex::escape(needle))
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| DocError::Parse(e.to_string()))?;
        let mut root = self.get_value(&Path::root())?;
        let mut count = 0u32;
        replace_in_value(&mut root, &re, replacement, &mut count);
        if count == 0 {
            return Ok(ReplaceResult {
                count: 0,
                applied: None,
            });
        }
        let applied = self.apply(&Op::SetValue {
            path: Path::root(),
            value: root,
        })?;
        Ok(ReplaceResult {
            count,
            applied: Some(applied),
        })
    }

    pub fn generate_types(&self, lang: TypegenLang, type_name: &str) -> DocResult<String> {
        Ok(match &self.inner {
            DocumentImpl::Eager(v) => generate_types(v, lang, type_name),
            DocumentImpl::Lazy(d) => match lang {
                TypegenLang::JsonSchema => {
                    let v = d.get_value(&Path::root())?;
                    generate_types(&v, lang, type_name)
                }
                _ => typegen_from_shape(&d.infer_shape(), lang, type_name),
            },
        })
    }

    pub fn validate_schema(&self, schema_text: &str) -> DocResult<SchemaValidationResult> {
        if self.source_size > GET_VALUE_ROOT_LIMIT {
            return Err(DocError::TooLarge {
                actual: self.source_size,
                limit: GET_VALUE_ROOT_LIMIT,
            });
        }
        let result = match &self.inner {
            DocumentImpl::Eager(v) => schema_validate_value(v, schema_text),
            DocumentImpl::Lazy(d) => {
                let v = d.get_value(&Path::root())?;
                schema_validate_value(&v, schema_text)
            }
        };
        result.map_err(|e| match e {
            SchemaCompileError::Parse(s) => {
                DocError::Parse(format!("schema is not valid JSON: {}", s))
            }
            SchemaCompileError::Compile(s) => {
                DocError::Parse(format!("schema compile error: {}", s))
            }
        })
    }

    fn ensure_eager(&mut self) -> DocResult<&mut Value> {
        if matches!(self.inner, DocumentImpl::Lazy(_)) {
            if self.source_size > EDIT_SIZE_LIMIT {
                return Err(DocError::TooLarge {
                    actual: self.source_size,
                    limit: EDIT_SIZE_LIMIT,
                });
            }
            let placeholder = DocumentImpl::Eager(Value::Null);
            let old = std::mem::replace(&mut self.inner, placeholder);
            let lazy = match old {
                DocumentImpl::Lazy(l) => l,
                _ => unreachable!("checked above"),
            };
            let value: Value =
                serde_json::from_str(lazy.source()).map_err(|e| DocError::Parse(e.to_string()))?;
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
    use super::*;

    fn doc(text: &str) -> Document {
        Document::from_text(text, None).expect("valid JSON in test")
    }

    #[test]
    fn parse_invalid_returns_parse_error() {
        let err = Document::from_text("{not json", None).unwrap_err();
        assert!(matches!(err, DocError::Parse(_)));
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
    fn set_file_path_makes_doc_file_backed() {
        let mut d = Document::from_text(r#"{"a": 1}"#, Some("orig.json".into())).unwrap();
        assert!(!d.summary().file_backed);
        d.set_file_path("/tmp/whatever.json".into());
        assert!(d.summary().file_backed, "re-attached path → file-backed");
        d.apply(&Op::SetValue {
            path: Path::root(),
            value: serde_json::json!({ "a": 2 }),
        })
        .unwrap();
        assert!(d.summary().dirty);
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
    fn invalid_lazy_doc_returns_parse_error() {
        let pad: String = std::iter::repeat('x').take(11 * 1024 * 1024).collect();
        let bad = format!(r#"{{"pad": "{}",}}"#, pad); // trailing comma
        let err = Document::from_text(&bad, None).unwrap_err();
        assert!(matches!(err, DocError::Parse(_)));
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
        let mut d = doc(r#"[{"n": 3}, {"n": 1}, {"n": 2}]"#);
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
        let mut d = doc(r#"[{"n": 3}, {"n": 1}, {"n": 2}, {"n": 0}]"#);
        let win = d.get_rows_sorted(&Path::root(), "n", false, 1..3).unwrap();
        assert_eq!(win.iter().map(|r| r.index).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn get_rows_sorted_mixed_kinds_grouped_by_kind() {
        let mut d = doc(r#"[{"v": "z"}, {"v": 5}, {"v": true}, {}, {"v": null}]"#);
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
        assert_eq!(
            result.inverse,
            super::super::ops::Op::SetValue {
                path: Path(vec![PathSegment::Key("a".into())]),
                value: serde_json::json!(1),
            }
        );
        assert_eq!(result.affected_paths.len(), 1);
    }

    #[test]
    fn apply_then_inverse_returns_to_initial() {
        let mut d = doc(r#"{"events": [10, 20, 30]}"#);
        let initial = d.get_value(&Path::root()).unwrap();
        let op = super::super::ops::Op::DeleteItem {
            path: Path(vec![PathSegment::Key("events".into())]),
            index: 1,
        };
        let r = d.apply(&op).unwrap();
        assert_eq!(
            d.get_value(&Path::root()).unwrap(),
            serde_json::json!({"events": [10, 30]})
        );
        d.apply(&r.inverse).unwrap();
        assert_eq!(d.get_value(&Path::root()).unwrap(), initial);
        assert_eq!(d.version, 2);
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
        let err = big.apply(&op).unwrap_err();
        assert!(matches!(err, DocError::TooLarge { .. }));
        assert!(matches!(big.inner, DocumentImpl::Lazy(_)));
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
        let mut d = doc(r#"[
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
        let mut d = doc(r#"[
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
        let mut d = doc(&format!("[{body}]"));
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
        let mut d = doc(r#"[
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
        assert_eq!(cv.values[0].value, serde_json::json!("Sindhi"));
        assert_eq!(cv.values[0].count, 2);
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
}
