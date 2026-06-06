use serde::{Deserialize, Serialize};

use crate::doc::backup::{self, BackupRecord};
use crate::doc::detect::{detect_and_convert, DetectResult};
use crate::doc::diff::{compute_diff, DiffEntry};
use crate::doc::document::{
    ApplyResult, ColumnValues, Document, FilteredRows, HistoryView, ReplaceResult, SaveResult,
    SortedRow, Summary,
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
use crate::doc::types::{ColumnSchema, DocError, DocHandle, DocResult, NodeView, Path};

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
    let l_doc = l_arc.read();
    let r_doc = r_arc.read();
    let l_val = l_doc.get_value(&Path::root())?;
    let r_val = r_doc.get_value(&Path::root())?;
    Ok(compute_diff(&l_val, &r_val))
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

#[allow(clippy::too_many_arguments)]
fn doc_get_rows_sorted_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    start: u32,
    end: u32,
    key: &str,
    descending: bool,
) -> DocResult<Vec<SortedRow>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    doc.get_rows_sorted(path, key, descending, start..end)
}

#[allow(clippy::too_many_arguments)]
fn doc_get_rows_filtered_inner(
    store: &DocStore,
    handle: DocHandle,
    path: &Path,
    start: u32,
    end: u32,
    groups: Vec<Vec<GridFilter>>,
    quick: Option<String>,
    quick_keys: Vec<String>,
    sort_key: Option<String>,
    descending: bool,
    cancel: &crate::doc::jobs::CancelFlag,
) -> DocResult<FilteredRows> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let mut doc = arc.write();
    let sort = sort_key.as_deref().map(|k| (k, descending));
    doc.get_rows_filtered(
        path,
        &groups,
        quick.as_deref(),
        &quick_keys,
        sort,
        start..end,
        cancel,
    )
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

fn doc_search_inner(
    store: &DocStore,
    handle: DocHandle,
    opts: SearchOptions,
    cancel: &crate::doc::jobs::CancelFlag,
) -> DocResult<Vec<SearchHit>> {
    let arc = store.get(handle).ok_or(DocError::NotFound(handle))?;
    let doc = arc.read();
    doc.search(&opts, cancel)
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
    state: tauri::State<'_, DocStore>,
    source: OpenSource,
) -> Result<OpenResult, String> {
    doc_open_inner(&state, source).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_close(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
) -> Result<bool, String> {
    Ok(doc_close_inner(&state, handle))
}

#[tauri::command]
pub async fn doc_get_slice(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<NodeView>, String> {
    doc_get_slice_inner(&state, handle, &path, start, end).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_get_value(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
) -> Result<serde_json::Value, String> {
    doc_get_value_inner(&state, handle, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_summary(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
) -> Result<Summary, String> {
    doc_summary_inner(&state, handle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_child_count(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
) -> Result<Option<u32>, String> {
    doc_child_count_inner(&state, handle, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_diff(
    state: tauri::State<'_, DocStore>,
    left: DocHandle,
    right: DocHandle,
) -> Result<Vec<DiffEntry>, String> {
    doc_diff_inner(&state, left, right).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_get_rows(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
) -> Result<Vec<serde_json::Value>, String> {
    doc_get_rows_inner(&state, handle, &path, start, end).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn doc_get_rows_sorted(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
    start: u32,
    end: u32,
    key: String,
    descending: bool,
) -> Result<Vec<SortedRow>, String> {
    doc_get_rows_sorted_inner(&state, handle, &path, start, end, &key, descending)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn doc_get_rows_filtered(
    state: tauri::State<'_, DocStore>,
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
) -> Result<FilteredRows, String> {
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag, Some(id))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = doc_get_rows_filtered_inner(
        &state, handle, &path, start, end, groups, quick, quick_keys, sort_key, descending, &cancel,
    )
    .map_err(|e| e.to_string());
    if let Some(id) = owned_id {
        jobs.unregister(&id);
    }
    result
}

#[tauri::command]
pub async fn doc_get_rows_at(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
    indices: Vec<u32>,
) -> Result<Vec<serde_json::Value>, String> {
    doc_get_rows_at_inner(&state, handle, &path, indices).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_column_values(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
    key: String,
    limit: u32,
) -> Result<ColumnValues, String> {
    doc_column_values_inner(&state, handle, &path, &key, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_column_schema(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Path,
) -> Result<ColumnSchema, String> {
    doc_column_schema_inner(&state, handle, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_apply_op(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    op: Op,
) -> Result<ApplyResult, String> {
    doc_apply_op_inner(&state, handle, op).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_set_root_text(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    text: String,
) -> Result<ApplyResult, String> {
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid JSON: {e}"))?;
    doc_apply_op_inner(
        &state,
        handle,
        Op::SetValue {
            path: Path::root(),
            value,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_undo(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, String> {
    doc_undo_inner(&state, handle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_redo(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
) -> Result<Option<ApplyResult>, String> {
    doc_redo_inner(&state, handle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_search(
    state: tauri::State<'_, DocStore>,
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    handle: DocHandle,
    opts: SearchOptions,
    job_id: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    let (cancel, owned_id) = match job_id {
        Some(id) => {
            let flag = jobs.register(id.clone());
            (flag, Some(id))
        }
        None => (crate::doc::jobs::CancelFlag::never(), None),
    };
    let result = doc_search_inner(&state, handle, opts, &cancel).map_err(|e| e.to_string());
    if let Some(id) = owned_id {
        jobs.unregister(&id);
    }
    result
}

#[tauri::command]
pub async fn cancel_job(
    jobs: tauri::State<'_, std::sync::Arc<crate::doc::jobs::JobRegistry>>,
    job_id: String,
) -> Result<bool, String> {
    Ok(jobs.cancel(&job_id))
}

#[tauri::command]
pub async fn doc_repair_text(text: String) -> Result<RepairResult, String> {
    Ok(repair_string(&text))
}

#[tauri::command]
pub async fn doc_detect_and_convert(text: String) -> Result<DetectResult, String> {
    Ok(detect_and_convert(&text))
}

#[tauri::command]
pub async fn doc_history(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
) -> Result<HistoryView, String> {
    doc_history_inner(&state, handle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_save(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: Option<String>,
) -> Result<SaveResult, String> {
    doc_save_inner(&state, handle, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_set_file_path(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    path: String,
) -> Result<Summary, String> {
    doc_set_file_path_inner(&state, handle, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    display_name: Option<String>,
) -> Result<bool, String> {
    let (dirty, source_path, content) = {
        let arc = state
            .get(handle)
            .ok_or_else(|| DocError::NotFound(handle).to_string())?;
        let doc = arc.read();
        let s = doc.summary();
        if !s.dirty {
            (false, None, String::new())
        } else {
            let content = doc.serialize().map_err(|e| e.to_string())?;
            (true, s.source_path.clone(), content)
        }
    };
    if !dirty {
        backup::clear(&app, &handle.to_string()).map_err(|e| e.to_string())?;
        return Ok(false);
    }
    backup::write(
        &app,
        &handle.to_string(),
        source_path,
        display_name,
        content,
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn doc_backup_clear(app: tauri::AppHandle, doc_id: String) -> Result<(), String> {
    backup::clear(&app, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_backup_scan(app: tauri::AppHandle) -> Result<Vec<BackupRecord>, String> {
    backup::scan_once(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_export(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    format: ExportFormat,
) -> Result<String, String> {
    doc_export_inner(&state, handle, format).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_export_preview(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    format: ExportFormat,
    max_chars: u32,
) -> Result<ExportPreview, String> {
    doc_export_preview_inner(&state, handle, format, max_chars).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_export_to_file(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    format: ExportFormat,
    path: String,
) -> Result<(), String> {
    doc_export_to_file_inner(&state, handle, format, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_replace(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    query: String,
    replacement: String,
    case_sensitive: bool,
) -> Result<ReplaceResult, String> {
    doc_replace_inner(&state, handle, &query, &replacement, case_sensitive)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_validate_schema(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    schema: String,
) -> Result<SchemaValidationResult, String> {
    doc_validate_schema_inner(&state, handle, schema).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn doc_generate_types(
    state: tauri::State<'_, DocStore>,
    handle: DocHandle,
    lang: TypegenLang,
    type_name: String,
) -> Result<String, String> {
    doc_generate_types_inner(&state, handle, lang, type_name).map_err(|e| e.to_string())
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
