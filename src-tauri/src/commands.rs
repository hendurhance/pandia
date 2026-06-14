use serde::{Deserialize, Serialize};

use crate::doc::backup::{self, BackupRecord};
use crate::doc::detect::{detect_and_convert, DetectResult};
use crate::doc::diff::{compute_diff, DiffEntry};
use crate::doc::document::{
    ApplyResult, ColumnValues, Document, HistoryView, ReplaceResult, SaveResult, SortedRow,
    Summary, EDIT_SIZE_LIMIT,
};
use crate::doc::export::{ExportFormat, ExportPreview};
use crate::doc::grid_filter::GridFilter;
use crate::doc::ops::Op;
use crate::doc::repair::{repair as repair_string, RepairResult};
use crate::doc::schema::sniff_columns;
use crate::doc::schema_validate::SchemaValidationResult;
use crate::doc::search::{SearchHit, SearchOptions};
use crate::doc::store::DocStore;
use crate::doc::typegen::TypegenLang;
use crate::doc::types::{
    ColumnSchema, DocError, DocHandle, DocResult, ErrorKind, NodeView, Path, WireError,
};
use parking_lot::RwLock;
use std::sync::Arc;

type SharedDoc = Arc<RwLock<Document>>;

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
        }),
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OpenSource {
    File { path: String },
    Text { text: String, name: Option<String> },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub handle: DocHandle,
    pub summary: Summary,
}

fn doc_open_inner(store: &DocStore, source: OpenSource) -> DocResult<OpenResult> {
    let doc = match source {
        OpenSource::File { path } => Document::from_file(&path)?,
        OpenSource::Text { text, name } => Document::from_text(&text, name)?,
    };
    let summary = doc.summary();
    let handle = store.insert(doc);
    Ok(OpenResult { handle, summary })
}

fn doc_close_inner(store: &DocStore, handle: DocHandle) -> bool {
    store.remove(handle)
}

fn doc_get_slice_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    start: u32,
    end: u32,
) -> DocResult<Vec<NodeView>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.get_slice(path, start..end)
}

fn doc_get_value_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
) -> DocResult<serde_json::Value> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.get_value(path)
}

fn doc_value_json_inner(store: &DocStore, handle: DocHandle, path: &Path) -> DocResult<String> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    let value = doc.get_value(path)?;
    serde_json::to_string_pretty(&value).map_err(|e| DocError::Export(e.to_string()))
}

fn doc_child_count_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
) -> DocResult<Option<u32>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.child_count_at(path)
}

fn doc_summary_inner(store: &DocStore, handle: DocHandle) -> DocResult<Summary> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    Ok(doc.summary())
}

#[cfg(test)]
fn doc_diff_inner(
    store: &DocStore,
    left: DocHandle,
    right: DocHandle,
) -> DocResult<Vec<DiffEntry>> {
    if left == right {
        return Ok(Vec::new());
    }
    let l_arc = store.get(left).ok_or(DocError::NotFound(left))?;
    let r_arc = store.get(right).ok_or(DocError::NotFound(right))?;
    diff_arcs(l_arc, r_arc, &crate::doc::jobs::CancelFlag::never())
}

fn diff_arcs(
    l_arc: SharedDoc,
    r_arc: SharedDoc,
    cancel: &crate::doc::jobs::CancelFlag,
) -> DocResult<Vec<DiffEntry>> {
    let l_doc = l_arc.read();
    let r_doc = r_arc.read();
    let l_val = l_doc.get_value(&Path::root())?;
    let r_val = r_doc.get_value(&Path::root())?;
    compute_diff(&l_val, &r_val, cancel)
}

fn doc_get_rows_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    start: u32,
    end: u32,
) -> DocResult<Vec<serde_json::Value>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.get_rows(path, start..end)
}

fn doc_get_rows_at_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    indices: Vec<u32>,
) -> DocResult<Vec<serde_json::Value>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.get_rows_at(path, &indices)
}

fn doc_column_values_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    key: &str,
    limit: u32,
) -> DocResult<ColumnValues> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.column_values(path, key, limit as usize)
}

fn doc_column_schema_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
) -> DocResult<ColumnSchema> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    sniff_columns(&doc, path)
}

fn doc_apply_op_inner(store: &DocStore, handle: DocHandle, op: Op) -> DocResult<ApplyResult> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.apply(&op)
}

fn doc_undo_inner(store: &DocStore, handle: DocHandle) -> DocResult<Option<ApplyResult>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.undo()
}

fn doc_redo_inner(store: &DocStore, handle: DocHandle) -> DocResult<Option<ApplyResult>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.redo()
}

fn doc_history_inner(store: &DocStore, handle: DocHandle) -> DocResult<HistoryView> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    Ok(doc.history_view())
}

fn doc_save_inner(
    store: &DocStore,
    handle: DocHandle,
    path: Option<String>,
) -> DocResult<SaveResult> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.save(path)
}

fn doc_export_inner(
    store: &DocStore,
    handle: DocHandle,
    format: ExportFormat,
) -> DocResult<String> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.export(format)
}

fn doc_export_preview_inner(
    store: &DocStore,
    handle: DocHandle,
    format: ExportFormat,
    max_chars: u32,
) -> DocResult<ExportPreview> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    let (text, truncated) = doc.export_preview(format, max_chars as usize)?;
    Ok(ExportPreview { text, truncated })
}

fn doc_export_to_file_inner(
    store: &DocStore,
    handle: DocHandle,
    format: ExportFormat,
    path: &str,
) -> DocResult<()> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.export_to_file(format, path)
}

fn doc_set_file_path_inner(
    store: &DocStore,
    handle: DocHandle,
    path: String,
) -> DocResult<Summary> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.set_file_path(path);
    Ok(doc.summary())
}

fn doc_replace_inner(
    store: &DocStore,
    handle: DocHandle,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> DocResult<ReplaceResult> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.replace_all(query, replacement, case_sensitive)
}

fn doc_validate_schema_inner(
    store: &DocStore,
    handle: DocHandle,
    schema: String,
) -> DocResult<SchemaValidationResult> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.validate_schema(&schema)
}

fn doc_generate_types_inner(
    store: &DocStore,
    handle: DocHandle,
    lang: TypegenLang,
    type_name: String,
) -> DocResult<String> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.generate_types(lang, &type_name)
}

#[tauri::command]
pub async fn doc_open(
    state: tauri::State<'_, Arc<DocStore>>,
    source: OpenSource,
) -> Result<OpenResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_open_inner(&store, source)).await
}

#[tauri::command]
pub async fn doc_close(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<bool, WireError> {
    Ok(doc_close_inner(&state, handle))
}

#[tauri::command]
pub async fn doc_get_slice(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<NodeView>, WireError> {
    doc_get_slice_inner(&state, handle, &path, start, end).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_get_value(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<serde_json::Value, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_get_value_inner(&store, handle, &path)).await
}

#[tauri::command]
pub async fn doc_value_json(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_value_json_inner(&store, handle, &path)).await
}

#[tauri::command]
pub async fn doc_summary(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Summary, WireError> {
    doc_summary_inner(&state, handle).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_child_count(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<Option<u32>, WireError> {
    doc_child_count_inner(&state, handle, &path).map_err(WireError::from)
}

#[tauri::command]
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
    let l_arc = state.get(left).ok_or(DocError::NotFound(left))?;
    let r_arc = state.get(right).ok_or(DocError::NotFound(right))?;
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag, Some(id))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || diff_arcs(l_arc, r_arc, &cancel)).await;
    if let Some(id) = owned_id {
        jobs.unregister(&id);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowJson {
    index: u32,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredRowsJson {
    total: u32,
    rows: Vec<RowJson>,
}

fn row_to_json(row: SortedRow) -> RowJson {
    RowJson {
        index: row.index,
        value: serde_json::to_string(&row.value).unwrap_or_else(|_| "null".into()),
    }
}

#[tauri::command]
pub async fn doc_get_rows(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<String>, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let values = doc_get_rows_inner(&store, handle, &path, start, end)?;
        Ok(values
            .iter()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".into()))
            .collect::<Vec<_>>())
    })
    .await
}

#[tauri::command]
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
    let arc = state.get(handle).ok_or(DocError::NotFound(handle))?;
    run_blocking(move || {
        let doc = arc.read();
        let rows = doc.get_rows_sorted(&path, &key, descending, start..end)?;
        Ok(rows.into_iter().map(row_to_json).collect::<Vec<_>>())
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn doc_get_rows_filtered(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
    groups: Vec<Vec<GridFilter>>,
    quick: Option<String>,
    quick_keys: Vec<String>,
    sort_key: Option<String>,
    descending: bool,
    job_id: Option<String>,
) -> Result<FilteredRowsJson, WireError> {
    let arc = state.get(handle).ok_or(DocError::NotFound(handle))?;
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag, Some(id))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || {
        let doc = arc.read();
        let sort = sort_key.as_deref().map(|k| (k, descending));
        let fr = doc.get_rows_filtered(
            &path,
            &groups,
            quick.as_deref(),
            &quick_keys,
            sort,
            start..end,
            &cancel,
        )?;
        Ok(FilteredRowsJson {
            total: fr.total,
            rows: fr.rows.into_iter().map(row_to_json).collect(),
        })
    })
    .await;
    if let Some(id) = owned_id {
        jobs.unregister(&id);
    }
    result
}

#[tauri::command]
pub async fn doc_get_rows_at(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    indices: Vec<u32>,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || {
        let values = doc_get_rows_at_inner(&store, handle, &path, indices)?;
        serde_json::to_string_pretty(&values).map_err(|e| DocError::Export(e.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn doc_column_values(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
    key: String,
    limit: u32,
) -> Result<ColumnValues, WireError> {
    doc_column_values_inner(&state, handle, &path, &key, limit).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_column_schema(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Path,
) -> Result<ColumnSchema, WireError> {
    doc_column_schema_inner(&state, handle, &path).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_apply_op(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    op: Op,
) -> Result<ApplyResult, WireError> {
    doc_apply_op_inner(&state, handle, op).map_err(WireError::from)
}

#[tauri::command]
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
        let value: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| DocError::Parse(format!("invalid JSON: {e}")))?;
        doc_apply_op_inner(
            &store,
            handle,
            Op::SetValue {
                path: Path::root(),
                value,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn doc_undo(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, WireError> {
    doc_undo_inner(&state, handle).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_redo(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, WireError> {
    doc_redo_inner(&state, handle).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_search(
    state: tauri::State<'_, Arc<DocStore>>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    opts: SearchOptions,
    job_id: Option<String>,
) -> Result<Vec<SearchHit>, WireError> {
    let arc = state.get(handle).ok_or(DocError::NotFound(handle))?;
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag, Some(id))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = run_blocking(move || {
        let doc = arc.read();
        doc.search(&opts, &cancel)
    })
    .await;
    if let Some(id) = owned_id {
        jobs.unregister(&id);
    }
    result
}

#[tauri::command]
pub async fn cancel_job(
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    job_id: String,
) -> Result<bool, WireError> {
    Ok(jobs.cancel(&job_id))
}

#[tauri::command]
pub async fn doc_repair_text(text: String) -> Result<RepairResult, WireError> {
    run_blocking(move || Ok(repair_string(&text))).await
}

#[tauri::command]
pub async fn doc_detect_and_convert(text: String) -> Result<DetectResult, WireError> {
    run_blocking(move || Ok(detect_and_convert(&text))).await
}

#[tauri::command]
pub async fn doc_history(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
) -> Result<HistoryView, WireError> {
    doc_history_inner(&state, handle).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_save(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: Option<String>,
) -> Result<SaveResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_save_inner(&store, handle, path)).await
}

#[tauri::command]
pub async fn doc_set_file_path(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    path: String,
) -> Result<Summary, WireError> {
    doc_set_file_path_inner(&state, handle, path).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    display_name: Option<String>,
) -> Result<bool, WireError> {
    let (dirty, source_path, content) = {
        let arc = state.get(handle).ok_or(DocError::NotFound(handle))?;
        let doc = arc.read();
        let s = doc.summary();
        if !s.dirty {
            (false, None, String::new())
        } else {
            let content = doc.serialize().map_err(WireError::from)?;
            (true, s.source_path.clone(), content)
        }
    };
    if !dirty {
        backup::clear(&app, &handle.to_string()).map_err(WireError::from)?;
        return Ok(false);
    }
    backup::write(
        &app,
        &handle.to_string(),
        source_path,
        display_name,
        content,
    )
    .map_err(WireError::from)?;
    Ok(true)
}

#[tauri::command]
pub async fn doc_backup_clear(app: tauri::AppHandle, doc_id: String) -> Result<(), WireError> {
    backup::clear(&app, &doc_id).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_backup_scan(app: tauri::AppHandle) -> Result<Vec<BackupRecord>, WireError> {
    backup::scan_once(&app).map_err(WireError::from)
}

#[tauri::command]
pub async fn doc_export(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_export_inner(&store, handle, format)).await
}

#[tauri::command]
pub async fn doc_export_preview(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
    max_chars: u32,
) -> Result<ExportPreview, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_export_preview_inner(&store, handle, format, max_chars)).await
}

#[tauri::command]
pub async fn doc_export_to_file(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    format: ExportFormat,
    path: String,
) -> Result<(), WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_export_to_file_inner(&store, handle, format, &path)).await
}

#[tauri::command]
pub async fn doc_replace(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_replace_inner(&store, handle, &query, &replacement, case_sensitive))
        .await
}

#[tauri::command]
pub async fn doc_validate_schema(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    schema: String,
) -> Result<SchemaValidationResult, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_validate_schema_inner(&store, handle, schema)).await
}

#[tauri::command]
pub async fn doc_generate_types(
    state: tauri::State<'_, Arc<DocStore>>,
    handle: DocHandle,
    lang: TypegenLang,
    type_name: String,
) -> Result<String, WireError> {
    let store = state.inner().clone();
    run_blocking(move || doc_generate_types_inner(&store, handle, lang, type_name)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::types::{NodeKind, PathSegment};

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

        assert!(doc_close_inner(&store, result.handle));
        assert!(!doc_close_inner(&store, result.handle));
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
        let slice = doc_get_slice_inner(&store, opened.handle, &path, 0, 10).unwrap();
        assert_eq!(slice.len(), 3);
        assert_eq!(slice[1].key, PathSegment::Index(1));
    }

    #[test]
    fn get_slice_unknown_handle_errors() {
        let store = DocStore::new();
        let err = doc_get_slice_inner(&store, DocHandle::new(), &Path::root(), 0, 10).unwrap_err();
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
        let v = doc_get_value_inner(&store, opened.handle, &path).unwrap();
        assert_eq!(v, serde_json::json!({"b": 42}));
    }

    #[test]
    fn value_json_preserves_big_integers_as_literals() {
        let store = DocStore::new();
        let opened = doc_open_inner(
            &store,
            OpenSource::Text {
                // 19 digits — beyond f64's exact integer range.
                text: r#"{"id": 123456789012345678}"#.into(),
                name: None,
            },
        )
        .unwrap();

        let path = Path(vec![PathSegment::Key("id".into())]);
        let json = doc_value_json_inner(&store, opened.handle, &path).unwrap();
        assert_eq!(json, "123456789012345678");
        assert!(!json.contains("123456789012345680")); // not rounded through f64
    }

    #[test]
    fn row_to_json_serializes_value_as_raw_text() {
        let value: serde_json::Value = serde_json::from_str("123456789012345678").unwrap();
        let rj = row_to_json(SortedRow { index: 7, value });
        assert_eq!(rj.index, 7);
        assert_eq!(rj.value, "123456789012345678"); // raw JSON text, not an f64
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
        let entries = doc_diff_inner(&store, left.handle, right.handle).unwrap();
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
        let entries = doc_diff_inner(&store, opened.handle, opened.handle).unwrap();
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
        let err = doc_diff_inner(&store, opened.handle, DocHandle::new()).unwrap_err();
        assert!(matches!(err, DocError::NotFound(_)));
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
        let rows = doc_get_rows_inner(&store, opened.handle, &Path::root(), 0, 10).unwrap();
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
        let s = doc_column_schema_inner(&store, opened.handle, &Path::root()).unwrap();
        assert!(s.grid_suitable);
        assert_eq!(s.row_count, 2);
        assert_eq!(s.columns.len(), 2);
    }

    #[test]
    fn column_schema_unknown_handle_errors() {
        let store = DocStore::new();
        let err = doc_column_schema_inner(&store, DocHandle::new(), &Path::root()).unwrap_err();
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
