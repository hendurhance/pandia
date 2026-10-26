use serde::{Deserialize, Serialize};
use sonic_rs::FastStr;

use crate::doc::backup::{self, BackupRecord};
use crate::doc::detect::{detect_and_convert, DetectKind};
use crate::doc::diagnose::{diagnose, Diagnosis};
use crate::doc::diff::{compute_diff, DiffEntry};
use crate::doc::document::{
    ApplyResult, ColumnValues, Document, HistoryView, ReplaceResult, SaveResult, SortedRow,
    Summary, EDIT_SIZE_LIMIT,
};
use crate::doc::export::{ExportFormat, ExportPreview};
use crate::doc::grid_filter::{self, FilterOp};
use crate::doc::lazy::parse_json;
use crate::doc::linediff::{compute_line_diff, line_slice, LineDiffResult, LINE_FETCH_MAX};
use crate::doc::ops::Op;
use crate::doc::repair::repair;
use crate::doc::schema::sniff_columns;
use crate::doc::schema_validate::SchemaValidationResult;
use crate::doc::search::{SearchHit, SearchOptions};
use crate::doc::store::DocStore;
use crate::doc::typegen::TypegenLang;
use crate::doc::types::{
    ColumnSchema, DocError, DocHandle, DocResult, ErrorKind, FileOp, NodeView, Path, WireError,
};
use crate::doc::wire::LosslessText;
use std::sync::Arc;

async fn run_blocking<T, F>(f: F) -> Result<T, WireError>
where
    F: FnOnce() -> DocResult<T> + Send + 'static,
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result.map_err(WireError::from),
        Err(join_err) => Err(WireError {
            kind: ErrorKind::Io,
            message: join_err.to_string(),
            detail: None,
            path: None,
            actual: None,
            limit: None,
            io: None,
        }),
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenSource {
    File { path: String },
    Text { text: String, name: Option<String> },
    Piped { path: String },
}

#[derive(Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    pub repair: bool,
}

#[derive(Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenNotes {
    pub converted_from: Option<DetectKind>,
    pub repairs: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    pub handle: DocHandle,
    pub summary: Summary,
    pub notes: OpenNotes,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenFailure {
    pub detail: String,
    pub too_large_to_fix: bool,
    pub diagnosis: Diagnosis,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenOutcome {
    Opened(OpenedDoc),
    Failed(OpenFailure),
}

fn doc_open_inner(
    store: &DocStore,
    source: OpenSource,
    options: OpenOptions,
) -> DocResult<OpenOutcome> {
    open_with_fix_limit(store, source, options, EDIT_SIZE_LIMIT)
}

fn open_with_fix_limit(
    store: &DocStore,
    source: OpenSource,
    options: OpenOptions,
    fix_limit: u64,
) -> DocResult<OpenOutcome> {
    let (text, name, file_path) = read_source(source)?;
    let text = FastStr::from_string(text);
    let detail = match Document::from_source(text.clone(), name.clone()) {
        Ok(mut doc) => {
            doc.file_path = file_path;
            return Ok(opened(store, doc, OpenNotes::default()));
        }
        Err(DocError::Parse(detail)) => detail,
        Err(e) => return Err(e),
    };

    let fixable = text.len() as u64 <= fix_limit;
    let starts_like_json = matches!(
        text.trim_start_matches('\u{feff}')
            .trim_start()
            .chars()
            .next(),
        Some('{' | '[')
    );
    if fixable && !starts_like_json {
        let detected = detect_and_convert(&text);
        if detected.error.is_none()
            && !matches!(detected.kind, DetectKind::Json | DetectKind::Unknown)
        {
            let doc =
                Document::from_text(&detected.json, Some(copy_name(name.as_deref(), "json")))?;
            let notes = OpenNotes {
                converted_from: Some(detected.kind),
                ..OpenNotes::default()
            };
            return Ok(opened(store, doc, notes));
        }
    }
    if fixable && options.repair {
        if let Some(repaired) = repair(&text) {
            let name = copy_name(name.as_deref(), "repaired.json");
            if let Ok(doc) = Document::from_text(&repaired.json, Some(name)) {
                let notes = OpenNotes {
                    repairs: repaired.notes,
                    ..OpenNotes::default()
                };
                return Ok(opened(store, doc, notes));
            }
        }
    }
    Ok(OpenOutcome::Failed(OpenFailure {
        detail,
        too_large_to_fix: !fixable,
        diagnosis: diagnose(&text, fixable),
    }))
}

fn opened(store: &DocStore, doc: Document, notes: OpenNotes) -> OpenOutcome {
    let summary = doc.summary();
    let handle = store.insert(doc);
    OpenOutcome::Opened(OpenedDoc {
        handle,
        summary,
        notes,
    })
}

fn read_source(source: OpenSource) -> DocResult<(String, Option<String>, Option<String>)> {
    match source {
        OpenSource::File { path } => {
            let text = Document::read_text_file(std::path::Path::new(&path))?;
            Ok((text, Some(path.clone()), Some(path)))
        }
        OpenSource::Text { text, name } => Ok((text, name, None)),
        OpenSource::Piped { path } => {
            let file = std::path::Path::new(&path);
            if !crate::cli::is_stdin_handoff(&path) {
                return Err(DocError::file(
                    FileOp::Open,
                    file,
                    std::io::ErrorKind::NotFound.into(),
                ));
            }
            let text = Document::read_text_file(file)?;
            Ok((text, Some("stdin".into()), None))
        }
    }
}

fn copy_name(name: Option<&str>, suffix: &str) -> String {
    let stem = name
        .and_then(|n| std::path::Path::new(n).file_stem())
        .map_or_else(|| "untitled".into(), |s| s.to_string_lossy().into_owned());
    format!("{stem}.{suffix}")
}

fn diff_docs(
    store: &DocStore,
    left: DocHandle,
    right: DocHandle,
    cancel: &crate::doc::jobs::CancelFlag,
) -> DocResult<Vec<DiffEntry>> {
    let (l_val, r_val) = store.read_both(left, right, |l, r| {
        Ok((l.get_value(&Path::root())?, r.get_value(&Path::root())?))
    })?;
    compute_diff(&l_val, &r_val, cancel)
}

fn diff_lines_docs(
    store: &DocStore,
    left: DocHandle,
    right: DocHandle,
    cancel: &crate::doc::jobs::CancelFlag,
) -> DocResult<LineDiffResult> {
    if left == right {
        let (_, starts) = store.read(left, |doc| doc.canonical_lines())?;
        let lines = starts.len() as u32;
        return Ok(LineDiffResult {
            hunks: Vec::new(),
            left_lines: lines,
            right_lines: lines,
        });
    }
    let (l_text, r_text) = store.read_both(left, right, |l, r| {
        Ok((l.canonical_lines()?.0, r.canonical_lines()?.0))
    })?;
    compute_line_diff(&l_text, &r_text, cancel)
}

fn doc_get_lines_inner(
    store: &DocStore,
    handle: DocHandle,
    start: u32,
    end: u32,
) -> DocResult<Vec<String>> {
    let lines = end.saturating_sub(start);
    if lines > LINE_FETCH_MAX {
        return Err(DocError::RangeTooLarge {
            lines,
            limit: LINE_FETCH_MAX,
        });
    }
    store.read(handle, |doc| {
        let (text, starts) = doc.canonical_lines()?;
        Ok(line_slice(&text, &starts, start..end))
    })
}

fn doc_save_inner(
    store: &DocStore,
    handle: DocHandle,
    path: Option<String>,
) -> DocResult<SaveResult> {
    let save_lock = store.read(handle, |doc| Ok(doc.save_lock()))?;
    let _one_save_at_a_time = save_lock.lock();
    let pending = store.read(handle, |doc| doc.prepare_save(path))?;
    pending.write()?;
    store.write(handle, |doc| Ok(doc.finish_save(&pending)))
}

#[tauri::command]
#[specta::specta]
pub async fn doc_open(
    state: tauri::State<'_, Arc<DocStore>>,
    source: OpenSource,
    options: OpenOptions,
) -> Result<OpenOutcome, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_open_inner(&store, source, options)).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_close(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<bool, WireError> {
    Ok(state.remove(handle))
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_slice(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<NodeView>, WireError> {
    state
        .read(handle, |doc| doc.get_slice(&path, start..end))
        .map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_value(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<LosslessText, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let value = store.read(handle, |doc| doc.get_value(&path))?;
        Ok(LosslessText::from_value_pretty(&value))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_summary(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Summary, WireError> {
    state
        .read(handle, |doc| Ok(doc.summary()))
        .map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_child_count(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<Option<u32>, WireError> {
    state
        .read(handle, |doc| doc.child_count_at(&path))
        .map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_diff(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    left: DocHandle,
    right: DocHandle,
    job_id: Option<String>,
) -> Result<Vec<DiffEntry>, WireError> {
    if left == right {
        return Ok(Vec::new());
    }
    let store = state.inner().clone();
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag.clone(), Some((id, flag)))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || diff_docs(&store, left, right, &cancel)).await;
    if let Some((id, flag)) = owned_id {
        jobs.unregister(&id, &flag);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn doc_diff_lines(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    left: DocHandle,
    right: DocHandle,
    job_id: Option<String>,
) -> Result<LineDiffResult, WireError> {
    let store = state.inner().clone();
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag.clone(), Some((id, flag)))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || diff_lines_docs(&store, left, right, &cancel)).await;
    if let Some((id, flag)) = owned_id {
        jobs.unregister(&id, &flag);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_lines(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    start: u32,
    end: u32,
) -> Result<Vec<String>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_get_lines_inner(&store, handle, start, end)).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_canonical_text(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<LosslessText, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        store.read(handle, |doc| {
            let (text, _) = doc.canonical_lines()?;
            Ok(LosslessText::from_raw((*text).clone()))
        })
    })
    .await
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalRange {
    pub start: u64,
    pub end: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn doc_canonical_offsets(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    paths: Vec<Path>,
) -> Result<Vec<Option<CanonicalRange>>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let offsets = store.read(handle, |doc| doc.canonical_offsets(&paths))?;
        Ok(offsets
            .into_iter()
            .map(|o| o.map(|(start, end)| CanonicalRange { start, end }))
            .collect())
    })
    .await
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RowJson {
    index: u32,
    value: LosslessText,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FilteredRowsJson {
    total: u32,
    rows: Vec<RowJson>,
}

fn row_to_json(row: SortedRow) -> RowJson {
    RowJson {
        index: row.index,
        value: LosslessText::from_value(&row.value),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_rows(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<LosslessText>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let values = store.read(handle, |doc| doc.get_rows(&path, start..end))?;
        Ok(values.iter().map(LosslessText::from_value).collect())
    })
    .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn doc_get_rows_sorted(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
    key: String,
    descending: bool,
) -> Result<Vec<RowJson>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let rows = store.read(handle, |doc| {
            doc.get_rows_sorted(&path, &key, descending, start..end)
        })?;
        Ok(rows.into_iter().map(row_to_json).collect::<Vec<_>>())
    })
    .await
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GridFilter {
    pub key: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Option<LosslessText>,
}

impl GridFilter {
    fn into_engine(self) -> DocResult<grid_filter::GridFilter> {
        Ok(grid_filter::GridFilter {
            key: self.key,
            op: self.op,
            value: self.value.map(|v| v.parse()).transpose()?,
        })
    }
}

fn filters_into_engine(
    groups: Vec<Vec<GridFilter>>,
) -> DocResult<Vec<Vec<grid_filter::GridFilter>>> {
    groups
        .into_iter()
        .map(|g| g.into_iter().map(GridFilter::into_engine).collect())
        .collect()
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GridQuery {
    pub groups: Vec<Vec<GridFilter>>,
    pub quick: Option<String>,
    pub quick_keys: Vec<String>,
    pub sort_key: Option<String>,
    pub descending: bool,
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn doc_get_rows_filtered(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
    query: GridQuery,
    job_id: Option<String>,
) -> Result<FilteredRowsJson, WireError> {
    let store = state.inner().clone();
    let groups = filters_into_engine(query.groups).map_err(WireError::from)?;
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag.clone(), Some((id, flag)))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || {
        let sort = query.sort_key.as_deref().map(|k| (k, query.descending));
        let fr = store.read(handle, |doc| {
            doc.get_rows_filtered(
                &path,
                &groups,
                query.quick.as_deref(),
                &query.quick_keys,
                sort,
                start..end,
                &cancel,
            )
        })?;
        Ok(FilteredRowsJson {
            total: fr.total,
            rows: fr.rows.into_iter().map(row_to_json).collect(),
        })
    })
    .await;
    if let Some((id, flag)) = owned_id {
        jobs.unregister(&id, &flag);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_rows_at(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    indices: Vec<u32>,
) -> Result<LosslessText, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let values = store.read(handle, |doc| doc.get_rows_at(&path, &indices))?;
        Ok(LosslessText::from_value_pretty(&serde_json::Value::Array(
            values,
        )))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_get_column(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    key: String,
) -> Result<LosslessText, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let values = store.read(handle, |doc| doc.get_column(&path, &key))?;
        Ok(LosslessText::from_value_pretty(&serde_json::Value::Array(
            values,
        )))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_column_values(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    key: String,
    limit: u32,
) -> Result<ColumnValues, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.read(handle, |doc| doc.column_values(&path, &key, limit as usize)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_column_schema(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<ColumnSchema, WireError> {
    state
        .read(handle, |doc| sniff_columns(doc, &path))
        .map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_scan_columns(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    path: Path,
    job_id: String,
) -> Result<Vec<crate::doc::types::Column>, WireError> {
    let store = state.inner().clone();
    let cancel = jobs.register(job_id.clone());
    let flag = cancel.clone();
    let result = run_blocking(move || {
        store.read(handle, |doc| {
            crate::doc::schema::scan_columns(doc, &path, &flag)
        })
    })
    .await;
    jobs.unregister(&job_id, &cancel);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn doc_apply_op(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    op: Op,
) -> Result<ApplyResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.write(handle, |doc| doc.apply(&op))).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_set_root_text(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    text: String,
) -> Result<ApplyResult, WireError> {
    if text.len() as u64 > EDIT_SIZE_LIMIT {
        return Err(DocError::TooLarge {
            actual: text.len() as u64,
            limit: EDIT_SIZE_LIMIT,
        }
        .into());
    }
    let store = state.inner().clone();
    run_blocking(move || {
        let value: serde_json::Value = parse_json(&text)?;
        store.write(handle, |doc| {
            doc.apply(&Op::SetValue {
                path: Path::root(),
                value,
            })
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_undo(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.write(handle, |doc| doc.undo())).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_redo(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.write(handle, |doc| doc.redo())).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_search(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    opts: SearchOptions,
    job_id: Option<String>,
) -> Result<Vec<SearchHit>, WireError> {
    let store = state.inner().clone();
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag.clone(), Some((id, flag)))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || store.read(handle, |doc| doc.search(&opts, &cancel))).await;
    if let Some((id, flag)) = owned_id {
        jobs.unregister(&id, &flag);
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_job(
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    job_id: String,
) -> Result<bool, WireError> {
    Ok(jobs.cancel(&job_id))
}

#[tauri::command]
#[specta::specta]
pub async fn doc_history(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<HistoryView, WireError> {
    state
        .read(handle, |doc| Ok(doc.history_view()))
        .map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_save(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Option<String>,
) -> Result<SaveResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_save_inner(&store, handle, path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn cli_reply(
    store: tauri::State<'_, Arc<DocStore>>,
    app: tauri::State<'_, crate::AppState>,
    handle: DocHandle,
    path: String,
) -> Result<(), WireError> {
    if !crate::cli::is_reply(&app.handoffs, &path) {
        return Err(DocError::file(
            FileOp::Save,
            std::path::Path::new(&path),
            std::io::ErrorKind::NotFound.into(),
        )
        .into());
    }
    let store = store.inner().clone();
    run_blocking(move || store.write(handle, |doc| doc.save_copy(&path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    display_name: Option<String>,
) -> Result<bool, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let (dirty, source_path, content) = store.read(handle, |doc| {
            let s = doc.summary();
            if !s.dirty {
                return Ok((false, None, String::new()));
            }
            Ok((true, s.source_path.clone(), doc.serialize()?))
        })?;
        if !dirty {
            backup::clear(&app, &handle.to_string())?;
            return Ok(false);
        }
        backup::write(
            &app,
            &handle.to_string(),
            source_path,
            display_name,
            content,
        )?;
        Ok(true)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_backup_clear(app: tauri::AppHandle, doc_id: String) -> Result<(), WireError> {
    backup::clear(&app, &doc_id).map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_backup_scan(app: tauri::AppHandle) -> Result<Vec<BackupRecord>, WireError> {
    backup::scan_once(&app).map_err(WireError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn doc_export(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.read(handle, |doc| doc.export(format))).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_export_preview(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
    max_chars: u32,
) -> Result<ExportPreview, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        store.read(handle, |doc| {
            let (text, truncated) = doc.export_preview(format, max_chars as usize)?;
            Ok(ExportPreview { text, truncated })
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_export_to_file(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
    path: String,
) -> Result<(), WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.read(handle, |doc| doc.export_to_file(format, &path))).await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_replace(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        store.write(handle, |doc| {
            doc.replace_all(&query, &replacement, case_sensitive)
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_validate_schema(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    schema: String,
) -> Result<SchemaValidationResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.read(handle, |doc| doc.validate_schema(&schema))).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_schema_file(path: String) -> Result<String, WireError> {
    run_blocking(move || {
        std::fs::read_to_string(&path)
            .map_err(|e| DocError::file(FileOp::Open, std::path::Path::new(&path), e))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn doc_generate_types(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    lang: TypegenLang,
    type_name: String,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || store.read(handle, |doc| doc.generate_types(lang, &type_name))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::types::{NodeKind, PathSegment};

    fn doc_open_inner(store: &DocStore, source: OpenSource) -> DocResult<OpenedDoc> {
        match super::doc_open_inner(store, source, OpenOptions::default())? {
            OpenOutcome::Opened(doc) => Ok(doc),
            OpenOutcome::Failed(f) => Err(DocError::Parse(f.detail)),
        }
    }

    fn open_file(store: &DocStore, name: &str, body: &str, repair: bool) -> OpenOutcome {
        static CALL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let call = CALL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("pandia-open-{}-{call}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        let path = path.to_string_lossy().into_owned();
        let outcome =
            super::doc_open_inner(store, OpenSource::File { path }, OpenOptions { repair });
        std::fs::remove_dir_all(&dir).unwrap();
        outcome.unwrap()
    }

    fn diff(store: &DocStore, left: DocHandle, right: DocHandle) -> DocResult<Vec<DiffEntry>> {
        diff_docs(store, left, right, &crate::doc::jobs::CancelFlag::never())
    }

    fn diff_lines(
        store: &DocStore,
        left: DocHandle,
        right: DocHandle,
    ) -> DocResult<LineDiffResult> {
        diff_lines_docs(store, left, right, &crate::doc::jobs::CancelFlag::never())
    }

    const CUT_OFF: &str = r#"[{"id":1,"url":"https://example.com/a","name":"first"},{"id":2,"url":"https://example.com/b","name":"second"},{"id":3,"name":"cut off her"#;

    #[test]
    fn a_valid_file_opens_attached_to_its_file_with_no_notes() {
        let store = DocStore::new();
        let OpenOutcome::Opened(doc) = open_file(&store, "ok.json", r#"{"a": 1}"#, true) else {
            panic!("expected to open");
        };
        assert!(doc.summary.file_backed);
        assert!(doc.notes.converted_from.is_none() && doc.notes.repairs.is_empty());
    }

    #[test]
    fn yaml_opens_as_an_unsaved_json_copy() {
        let store = DocStore::new();
        let OpenOutcome::Opened(doc) =
            open_file(&store, "data.yaml", "a: 1\nb:\n  - 2\n  - 3\n", false)
        else {
            panic!("expected to convert");
        };
        assert_eq!(doc.notes.converted_from, Some(DetectKind::Yaml));
        assert_eq!(doc.summary.source_path.as_deref(), Some("data.json"));
        assert!(!doc.summary.file_backed);
    }

    #[test]
    fn broken_json_repairs_into_an_unsaved_copy_that_keeps_every_value() {
        let store = DocStore::new();
        let OpenOutcome::Opened(doc) = open_file(&store, "cut.json", CUT_OFF, true) else {
            panic!("expected to repair");
        };
        assert_eq!(
            doc.summary.source_path.as_deref(),
            Some("cut.repaired.json")
        );
        assert!(
            !doc.summary.file_backed,
            "Save must not default to the broken original"
        );
        assert_eq!(doc.summary.root_child_count, Some(3));
        assert!(doc
            .notes
            .repairs
            .iter()
            .any(|n| n.contains("may be incomplete")));
        let url_path = Path(vec![PathSegment::Index(0), PathSegment::Key("url".into())]);
        let url = store.read(doc.handle, |d| d.get_value(&url_path)).unwrap();
        assert_eq!(url, serde_json::json!("https://example.com/a"));
    }

    #[test]
    fn broken_json_fails_with_a_diagnosis_when_repair_is_off() {
        let store = DocStore::new();
        let OpenOutcome::Failed(f) = open_file(&store, "cut.json", CUT_OFF, false) else {
            panic!("expected to fail");
        };
        assert!(!f.detail.is_empty());
        assert!(!f.too_large_to_fix);
        assert!(
            f.diagnosis.fix.is_some(),
            "the diagnosis still offers its repair"
        );
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn broken_json_is_never_converted_as_yaml() {
        let store = DocStore::new();
        let outcome = open_file(&store, "x.json", r#"{"a": 1 "b": 2}"#, false);
        assert!(matches!(outcome, OpenOutcome::Failed(_)));
    }

    #[test]
    fn text_over_the_fix_limit_fails_without_repairing() {
        let store = DocStore::new();
        for text in [CUT_OFF, "a: 1\nb:\n  - 2\n"] {
            let source = OpenSource::Text {
                text: text.into(),
                name: None,
            };
            let outcome =
                open_with_fix_limit(&store, source, OpenOptions { repair: true }, 10).unwrap();
            let OpenOutcome::Failed(f) = outcome else {
                panic!("expected to fail");
            };
            assert!(f.too_large_to_fix);
            assert!(
                f.diagnosis.fix.is_none(),
                "no fix is built for text this large"
            );
        }
    }

    const BOM_CUT_NDJSON: &str =
        "\u{feff}{\"id\":1,\"n\":\"a\"}\n{\"id\":2,\"n\":\"b\"}\n{\"id\":3,\"n\":\"c";

    #[test]
    fn a_byte_order_mark_does_not_turn_broken_json_into_csv() {
        let store = DocStore::new();
        let OpenOutcome::Failed(f) = open_file(&store, "log.json", BOM_CUT_NDJSON, false) else {
            panic!("expected to fail, not convert");
        };
        assert!(!f.diagnosis.title.contains("CSV"), "{}", f.diagnosis.title);
    }

    #[test]
    fn ndjson_with_a_cut_off_last_line_repairs_into_its_records() {
        let store = DocStore::new();
        let OpenOutcome::Opened(doc) = open_file(&store, "log.json", BOM_CUT_NDJSON, true) else {
            panic!("expected to repair");
        };
        assert!(doc.notes.converted_from.is_none());
        assert_eq!(doc.summary.root_child_count, Some(3));
    }

    #[test]
    fn a_lone_surrogate_escape_opens_after_repair() {
        let store = DocStore::new();
        let OpenOutcome::Opened(doc) = open_file(&store, "emoji.json", r#"{"a": "\ud83d"}"#, true)
        else {
            panic!("expected to repair");
        };
        assert!(
            doc.notes.repairs.iter().any(|n| n.contains('\u{fffd}')),
            "{:?}",
            doc.notes.repairs
        );
    }

    #[test]
    fn a_missing_file_is_still_an_error() {
        let store = DocStore::new();
        let path = "/definitely/not/here.json".to_string();
        let err = super::doc_open_inner(
            &store,
            OpenSource::File { path },
            OpenOptions { repair: true },
        )
        .unwrap_err();
        assert!(matches!(err, DocError::Io { .. }));
    }

    #[test]
    fn open_text_returns_handle_and_summary() {
        let store = DocStore::new();
        let result = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1, "b": 2}"#.into(),
                name: Some("test.json".into()),
            },
        )
        .unwrap();

        assert_eq!(result.summary.root_kind, NodeKind::Object);
        assert_eq!(result.summary.root_child_count, Some(2));
        assert_eq!(result.summary.source_path.as_deref(), Some("test.json"));
        assert_eq!(store.len(), 1);

        let json = serde_json::to_value(&result).unwrap();
        assert!(json.get("handle").is_some());
        assert!(json.get("summary").is_some());
    }

    #[test]
    fn piped_input_opens_as_an_unsaved_stdin_document() {
        let dir = std::env::temp_dir().join(format!("pandia-piped-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let handoff = dir.join("pandia-stdin-test.json");
        std::fs::write(&handoff, r#"[1, 2]"#).unwrap();
        let path = handoff.to_string_lossy().into_owned();

        let store = DocStore::new();
        let result = doc_open_inner(&store, OpenSource::Piped { path }).unwrap();
        assert_eq!(result.summary.source_path.as_deref(), Some("stdin"));
        assert!(!result.summary.file_backed);

        let other = dir.join("notes.json");
        std::fs::write(&other, "{}").unwrap();
        let path = other.to_string_lossy().into_owned();
        assert!(doc_open_inner(&store, OpenSource::Piped { path }).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn piped_input_over_the_size_limit_is_refused_before_it_is_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pandia-piped-big-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let handoff = dir.join("pandia-stdin-big.json");
        let file = std::fs::File::create(&handoff).unwrap();
        file.set_len(crate::doc::document::MAX_DOC_BYTES + 1)
            .unwrap();

        std::fs::set_permissions(&handoff, std::fs::Permissions::from_mode(0o000)).unwrap();
        let path = handoff.to_string_lossy().into_owned();

        let err = doc_open_inner(&DocStore::new(), OpenSource::Piped { path }).unwrap_err();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(matches!(err, DocError::TooLarge { .. }), "{err:?}");
    }

    #[test]
    fn open_invalid_text_returns_parse_error() {
        let store = DocStore::new();
        let err = doc_open_inner(
            &store,
            OpenSource::Text {
                text: "{not json".into(),
                name: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, DocError::Parse(_)));
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn close_known_handle_succeeds() {
        let store = DocStore::new();
        let result = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{}"#.into(),
                name: None,
            },
        )
        .unwrap();

        assert!(store.remove(result.handle));
        assert!(!store.remove(result.handle));
    }

    #[test]
    fn get_slice_routes_to_doc() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"events": [10, 20, 30]}"#.into(),
                name: None,
            },
        )
        .unwrap();

        let path = Path(vec![PathSegment::Key("events".into())]);
        let slice = store
            .read(opened.handle, |d| d.get_slice(&path, 0..10))
            .unwrap();
        assert_eq!(slice.len(), 3);
        assert_eq!(slice[1].key, PathSegment::Index(1));
    }

    #[test]
    fn get_slice_unknown_handle_errors() {
        let store = DocStore::new();
        let err = store
            .read(DocHandle::new(), |d| d.get_slice(&Path::root(), 0..10))
            .unwrap_err();
        assert!(matches!(err, DocError::NotFound(_)));
    }

    #[test]
    fn get_value_returns_subtree() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": {"b": 42}}"#.into(),
                name: None,
            },
        )
        .unwrap();

        let path = Path(vec![PathSegment::Key("a".into())]);
        let v = store.read(opened.handle, |d| d.get_value(&path)).unwrap();
        assert_eq!(v, serde_json::json!({"b": 42}));
    }

    #[test]
    fn get_value_preserves_big_integers_as_literals() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"id": 123456789012345678}"#.into(),
                name: None,
            },
        )
        .unwrap();

        let path = Path(vec![PathSegment::Key("id".into())]);
        let value = store.read(opened.handle, |d| d.get_value(&path)).unwrap();
        let text = LosslessText::from_value_pretty(&value);
        assert_eq!(text.as_str(), "123456789012345678");
        assert!(!text.as_str().contains("123456789012345680")); // not rounded through f64
    }

    #[test]
    fn row_to_json_serializes_value_as_raw_text() {
        let value: serde_json::Value = serde_json::from_str("123456789012345678").unwrap();
        let rj = row_to_json(SortedRow { index: 7, value });
        assert_eq!(rj.index, 7);
        assert_eq!(rj.value.as_str(), "123456789012345678"); // raw JSON text, not an f64
    }

    #[test]
    fn diff_routes_to_doc_compute() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1, "b": 2}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1, "b": 99, "c": 3}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let entries = diff(&store, left.handle, right.handle).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn diff_same_handle_returns_empty() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let entries = diff(&store, opened.handle, opened.handle).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn diff_unknown_handle_errors() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let err = diff(&store, opened.handle, DocHandle::new()).unwrap_err();
        assert!(matches!(err, DocError::NotFound(_)));
    }

    #[test]
    fn diff_lines_reports_hunks_over_canonical_text() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1, "b": 2}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1, "b": 99, "c": 3}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(d.left_lines, 4);
        assert_eq!(d.right_lines, 5);
        assert_eq!(d.hunks.len(), 1);
        assert_eq!(d.hunks[0].left_start, 2);
        assert_eq!(d.hunks[0].left_len, 1);
        assert_eq!(d.hunks[0].right_start, 2);
        assert_eq!(d.hunks[0].right_len, 2);
    }

    #[test]
    fn diff_lines_same_handle_returns_counts_without_hunks() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, opened.handle, opened.handle).unwrap();
        assert!(d.hunks.is_empty());
        assert_eq!(d.left_lines, 3);
        assert_eq!(d.right_lines, 3);
    }

    #[test]
    fn diff_lines_unknown_handle_errors() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let err = diff_lines(&store, opened.handle, DocHandle::new()).unwrap_err();
        assert!(matches!(err, DocError::NotFound(_)));
    }

    #[test]
    fn diff_lines_minified_vs_pretty_same_data_produces_zero_hunks() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a":1,"b":[1,2,3],"c":{"d":"x"}}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2,\n    3\n  ],\n  \"c\": {\n    \"d\": \"x\"\n  }\n}".into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert!(d.hunks.is_empty());
        assert_eq!(d.left_lines, d.right_lines);
        assert!(d.left_lines > 1);
    }

    #[test]
    fn diff_lines_minified_pair_reports_one_hunk_in_canonical_coordinates() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a":1,"b":2,"c":3}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a":1,"b":99,"c":3}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(d.left_lines, 5);
        assert_eq!(d.right_lines, 5);
        assert_eq!(
            d.hunks,
            vec![crate::doc::linediff::LineHunk {
                left_start: 2,
                left_len: 1,
                right_start: 2,
                right_len: 1,
            }]
        );
    }

    #[test]
    fn diff_lines_formatting_difference_adds_nothing_to_a_value_change() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a":1,"b":2,"c":3}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: "{\n  \"a\": 1,\n  \"b\": 99,\n  \"c\": 3\n}".into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(
            d.hunks,
            vec![crate::doc::linediff::LineHunk {
                left_start: 2,
                left_len: 1,
                right_start: 2,
                right_len: 1,
            }]
        );
    }

    #[test]
    fn diff_lines_reports_a_change_when_only_the_number_token_differs() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1.5}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1.50}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(
            d.hunks,
            vec![crate::doc::linediff::LineHunk {
                left_start: 1,
                left_len: 1,
                right_start: 1,
                right_len: 1,
            }]
        );
    }

    #[test]
    fn diff_lines_distinguishes_adjacent_snowflake_ids() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"id": 1075283027435454464}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"id": 1075283027435454465}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(d.hunks.len(), 1);
        let h = d.hunks[0];
        let l = doc_get_lines_inner(&store, left.handle, h.left_start, h.left_start + h.left_len)
            .unwrap();
        let r = doc_get_lines_inner(
            &store,
            right.handle,
            h.right_start,
            h.right_start + h.right_len,
        )
        .unwrap();
        assert_eq!(l, vec!["  \"id\": 1075283027435454464"]);
        assert_eq!(r, vec!["  \"id\": 1075283027435454465"]);
    }

    #[test]
    fn diff_lines_number_tokens_keep_line_counts_and_hunk_coordinates_valid() {
        let tokens = [
            "1.0",
            "1.50",
            "1E5",
            "1e20",
            "1e21",
            "1e-6",
            "1e999",
            "9007199254740993",
            "123456789012345678",
            "123456789012345678901234567890",
            "1075283027435454464",
            "-0.0",
            "5e-324",
            "1.7976931348623157e308",
        ];
        let left_text = format!("[{}]", tokens.join(","));
        let mut changed = tokens;
        changed[1] = "1.5";
        changed[10] = "1075283027435454465";
        let right_text = format!("[{}]", changed.join(","));
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: left_text,
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: right_text,
                name: None,
            },
        )
        .unwrap();
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert_eq!(d.left_lines, tokens.len() as u32 + 2);
        assert_eq!(d.right_lines, tokens.len() as u32 + 2);
        assert_eq!(d.hunks.len(), 2);
        for (h, (l_line, r_line)) in d.hunks.iter().zip([
            ("  1.50,", "  1.5,"),
            ("  1075283027435454464,", "  1075283027435454465,"),
        ]) {
            let l =
                doc_get_lines_inner(&store, left.handle, h.left_start, h.left_start + h.left_len)
                    .unwrap();
            let r = doc_get_lines_inner(
                &store,
                right.handle,
                h.right_start,
                h.right_start + h.right_len,
            )
            .unwrap();
            assert_eq!(l, vec![l_line]);
            assert_eq!(r, vec![r_line]);
        }
    }

    #[test]
    fn diff_lines_lazy_documents_diff_over_canonical_text() {
        const N: usize = 10_500;
        let item = "x".repeat(1000);
        let mut minified = String::with_capacity(11 << 20);
        minified.push('[');
        for i in 0..N {
            if i > 0 {
                minified.push(',');
            }
            minified.push_str(&format!("\"{item}{i}\""));
        }
        minified.push(']');
        let mut pretty = String::with_capacity(12 << 20);
        pretty.push_str("[\n");
        for i in 0..N {
            let sep = if i + 1 < N { "," } else { "" };
            pretty.push_str(&format!("  \"{item}{i}\"{sep}\n"));
        }
        pretty.push(']');

        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: minified,
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: pretty,
                name: None,
            },
        )
        .unwrap();
        assert!(left.summary.lazy);
        assert!(right.summary.lazy);
        let d = diff_lines(&store, left.handle, right.handle).unwrap();
        assert!(d.hunks.is_empty());
        assert_eq!(d.left_lines, (N + 2) as u32);
        assert_eq!(d.right_lines, (N + 2) as u32);
    }

    #[test]
    fn diff_lines_beyond_root_value_limit_errors_rather_than_diffing_raw_text() {
        let store = DocStore::new();
        let left = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let right = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 2}"#.into(),
                name: None,
            },
        )
        .unwrap();
        store
            .write(left.handle, |d| {
                d.source_size = 210 * 1024 * 1024;
                Ok(())
            })
            .unwrap();
        let err = diff_lines(&store, left.handle, right.handle).unwrap_err();
        assert!(matches!(err, DocError::TooLarge { .. }));
    }

    fn edit_wait_during(
        diff: impl FnOnce(&DocStore, DocHandle, DocHandle) + Send + 'static,
    ) -> (std::time::Duration, std::time::Duration) {
        let mut seed = 7u64;
        let mut digits = || {
            let items: Vec<String> = (0..8_000)
                .map(|_| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    ((seed >> 33) % 8).to_string()
                })
                .collect();
            Document::from_text(&format!("[{}]", items.join(",")), None).unwrap()
        };
        let store = Arc::new(DocStore::new());
        let (left, right) = (store.insert(digits()), store.insert(digits()));
        for handle in [left, right] {
            store.read(handle, |d| d.canonical_lines()).unwrap();
        }
        let s = Arc::clone(&store);
        let started = std::time::Instant::now();
        let running = std::thread::spawn(move || {
            diff(&s, left, right);
            started.elapsed()
        });
        std::thread::sleep(std::time::Duration::from_millis(20));
        let asked = std::time::Instant::now();
        store
            .write(left, |doc| {
                doc.apply(&Op::SetValue {
                    path: Path::root(),
                    value: serde_json::json!([]),
                })
            })
            .unwrap();
        let waited = asked.elapsed();
        (waited, running.join().unwrap())
    }

    #[test]
    fn an_edit_does_not_wait_for_a_running_line_diff() {
        let (waited, took) = edit_wait_during(|s, l, r| {
            diff_lines(s, l, r).unwrap();
        });
        assert!(
            waited < took / 4,
            "the edit waited {waited:?} for a {took:?} diff"
        );
    }

    #[test]
    fn an_edit_does_not_wait_for_a_running_structural_diff() {
        let (waited, took) = edit_wait_during(|s, l, r| {
            diff(s, l, r).unwrap();
        });
        assert!(
            waited < took / 4,
            "the edit waited {waited:?} for a {took:?} diff"
        );
    }

    #[cfg(unix)]
    struct SlowTarget {
        dir: std::path::PathBuf,
        path: String,
    }

    #[cfg(unix)]
    impl SlowTarget {
        fn new(name: &str) -> Self {
            use std::os::unix::fs::PermissionsExt;
            let dir = std::env::temp_dir().join(format!("pandia-{name}-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("out.json");
            let made = std::process::Command::new("mkfifo").arg(&path).status();
            assert!(made.unwrap().success());
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
            let path = path.to_string_lossy().into_owned();
            Self { dir, path }
        }

        fn read(&self) -> String {
            std::fs::read_to_string(&self.path).unwrap()
        }
    }

    #[cfg(unix)]
    impl Drop for SlowTarget {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.dir, std::fs::Permissions::from_mode(0o755));
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    #[cfg(unix)]
    fn an_edit_during_a_slow_save_neither_waits_nor_is_marked_saved() {
        let target = SlowTarget::new("slow-save");
        let store = Arc::new(DocStore::new());
        let handle = store.insert(Document::from_text(r#"{"a": 1}"#, None).unwrap());
        store
            .write(handle, |doc| {
                doc.apply(&Op::SetValue {
                    path: Path::root(),
                    value: serde_json::json!({"a": 5}),
                })
            })
            .unwrap();
        let (s, path) = (Arc::clone(&store), target.path.clone());
        let saving = std::thread::spawn(move || doc_save_inner(&s, handle, Some(path)));
        std::thread::sleep(std::time::Duration::from_millis(100));

        let (done, edited) = std::sync::mpsc::channel();
        let s = Arc::clone(&store);
        std::thread::spawn(move || {
            let edit = s.write(handle, |doc| {
                doc.apply(&Op::SetValue {
                    path: Path::root(),
                    value: serde_json::json!({"a": 2}),
                })
            });
            let _ = done.send(edit);
        });
        let edit = edited.recv_timeout(std::time::Duration::from_secs(2));
        let written = target.read();
        saving.join().unwrap().unwrap();

        assert!(
            edit.is_ok(),
            "the edit waited for the save to reach the disk"
        );
        assert_eq!(written, "{\n  \"a\": 5\n}");
        let dirty = store.read(handle, |d| Ok(d.summary().dirty)).unwrap();
        assert!(
            dirty,
            "the edit is not in the file, so the document stays unsaved"
        );
        store.write(handle, |doc| doc.undo()).unwrap();
        let dirty = store.read(handle, |d| Ok(d.summary().dirty)).unwrap();
        assert!(
            !dirty,
            "after undoing the edit, the document matches the file"
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_second_save_waits_until_the_first_has_written_its_file() {
        let target = SlowTarget::new("two-saves");
        let store = Arc::new(DocStore::new());
        let handle = store.insert(Document::from_text(r#"{"a": 1}"#, None).unwrap());
        let save = || {
            let (s, path) = (Arc::clone(&store), target.path.clone());
            std::thread::spawn(move || doc_save_inner(&s, handle, Some(path)))
        };
        let first = save();
        std::thread::sleep(std::time::Duration::from_millis(100));
        store
            .write(handle, |doc| {
                doc.apply(&Op::SetValue {
                    path: Path::root(),
                    value: serde_json::json!({"a": 2}),
                })
            })
            .unwrap();
        let second = save();
        std::thread::sleep(std::time::Duration::from_millis(100));

        assert_eq!(target.read(), "{\n  \"a\": 1\n}");
        first.join().unwrap().unwrap();
        assert_eq!(target.read(), "{\n  \"a\": 2\n}");
        second.join().unwrap().unwrap();
        assert!(!store.read(handle, |d| Ok(d.summary().dirty)).unwrap());
    }

    #[test]
    fn get_lines_pages_canonical_text_with_source_number_tokens() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"id": 123456789012345678}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let lines = doc_get_lines_inner(&store, opened.handle, 0, 10).unwrap();
        assert_eq!(lines, vec!["{", "  \"id\": 123456789012345678", "}"]);
        let middle = doc_get_lines_inner(&store, opened.handle, 1, 2).unwrap();
        assert_eq!(middle, vec!["  \"id\": 123456789012345678"]);
    }

    #[test]
    fn get_lines_rejects_oversized_range() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let err = doc_get_lines_inner(&store, opened.handle, 0, LINE_FETCH_MAX + 1).unwrap_err();
        assert!(matches!(err, DocError::RangeTooLarge { .. }));
    }

    #[test]
    fn get_lines_reflects_edits() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"{"a": 1}"#.into(),
                name: None,
            },
        )
        .unwrap();
        let before = doc_get_lines_inner(&store, opened.handle, 0, 10).unwrap();
        assert_eq!(before[1], "  \"a\": 1");
        store
            .write(opened.handle, |d| {
                d.apply(&Op::SetValue {
                    path: Path(vec![PathSegment::Key("a".into())]),
                    value: serde_json::json!(2),
                })
            })
            .unwrap();
        let after = doc_get_lines_inner(&store, opened.handle, 0, 10).unwrap();
        assert_eq!(after[1], "  \"a\": 2");
    }

    #[test]
    fn get_rows_routes_to_doc() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"[{"a":1},{"a":2},{"a":3}]"#.into(),
                name: None,
            },
        )
        .unwrap();
        let rows = store
            .read(opened.handle, |d| d.get_rows(&Path::root(), 0..10))
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], serde_json::json!({"a": 1}));
    }

    #[test]
    fn column_schema_routes_to_doc() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                text: r#"[{"id":1,"name":"a"},{"id":2,"name":"b"}]"#.into(),
                name: None,
            },
        )
        .unwrap();
        let s = store
            .read(opened.handle, |d| sniff_columns(d, &Path::root()))
            .unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.row_count, 2);
        assert_eq!(s.columns.len(), 2);
    }

    #[test]
    fn column_schema_unknown_handle_errors() {
        let store = DocStore::new();
        let err = store
            .read(DocHandle::new(), |d| sniff_columns(d, &Path::root()))
            .unwrap_err();
        assert!(matches!(err, DocError::NotFound(_)));
    }

    #[test]
    fn open_source_deserializes_tagged() {
        let file_form: OpenSource =
            serde_json::from_str(r#"{"kind": "file", "path": "/tmp/x.json"}"#).unwrap();
        assert!(matches!(file_form, OpenSource::File { .. }));

        let text_form: OpenSource =
            serde_json::from_str(r#"{"kind": "text", "text": "{}", "name": null}"#).unwrap();
        assert!(matches!(text_form, OpenSource::Text { .. }));
    }
}
