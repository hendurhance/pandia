import { invoke } from '@tauri-apps/api/core';
import type {
	ApplyResult,
	BackupRecord,
	ColumnSchema,
	DetectResult,
	DiffEntry,
	DocHandle,
	ExportFormat,
	HistoryView,
	NodeView,
	Op,
	OpenResult,
	OpenSource,
	Path,
	RepairResult,
	SaveResult,
	SchemaValidationResult,
	SearchHit,
	SearchOptions,
	Summary,
	TypegenLang,
} from './types';

export function docOpen(source: OpenSource): Promise<OpenResult> {
	return invoke<OpenResult>('doc_open', { source });
}

export function docClose(handle: DocHandle): Promise<boolean> {
	return invoke<boolean>('doc_close', { handle });
}

export function docGetSlice(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
): Promise<NodeView[]> {
	return invoke<NodeView[]>('doc_get_slice', { handle, path, start, end });
}

export function docGetValue(handle: DocHandle, path: Path): Promise<unknown> {
	return invoke<unknown>('doc_get_value', { handle, path });
}

export function docGetRows(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
): Promise<unknown[]> {
	return invoke<unknown[]>('doc_get_rows', { handle, path, start, end });
}

export interface SortedRow {
	index: number;
	value: unknown;
}

export function docGetRowsSorted(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
	key: string,
	descending: boolean,
): Promise<SortedRow[]> {
	return invoke<SortedRow[]>('doc_get_rows_sorted', { handle, path, start, end, key, descending });
}

export type FilterOp =
	| 'contains'
	| 'notContains'
	| 'eq'
	| 'ne'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'isEmpty'
	| 'isNotEmpty'
	| 'in'
	| 'notIn'
	| 'startsWith';

export interface GridFilter {
	key: string;
	op: FilterOp;
	value?: unknown;
}

export interface FilteredRows {
	total: number;
	rows: SortedRow[];
}

export function docGetRowsFiltered(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
	groups: GridFilter[][],
	quick: string | null,
	quickKeys: string[],
	sortKey: string | null,
	descending: boolean,
	jobId?: string,
): Promise<FilteredRows> {
	return invoke<FilteredRows>('doc_get_rows_filtered', {
		handle,
		path,
		start,
		end,
		groups,
		quick,
		quickKeys,
		sortKey,
		descending,
		jobId,
	});
}

export interface ColumnValue {
	value: unknown;
	count: number;
}
export interface ColumnValues {
	values: ColumnValue[];
	
	capped: boolean;
}

export function docGetRowsAt(handle: DocHandle, path: Path, indices: number[]): Promise<unknown[]> {
	return invoke<unknown[]>('doc_get_rows_at', { handle, path, indices });
}

export function docColumnValues(
	handle: DocHandle,
	path: Path,
	key: string,
	limit: number,
): Promise<ColumnValues> {
	return invoke<ColumnValues>('doc_column_values', { handle, path, key, limit });
}

export function docSummary(handle: DocHandle): Promise<Summary> {
	return invoke<Summary>('doc_summary', { handle });
}

export function docChildCount(handle: DocHandle, path: Path): Promise<number | null> {
	return invoke<number | null>('doc_child_count', { handle, path });
}

export function docColumnSchema(handle: DocHandle, path: Path): Promise<ColumnSchema> {
	return invoke<ColumnSchema>('doc_column_schema', { handle, path });
}

export function docApplyOp(handle: DocHandle, op: Op): Promise<ApplyResult> {
	return invoke<ApplyResult>('doc_apply_op', { handle, op });
}

export function docSetRootText(handle: DocHandle, text: string): Promise<ApplyResult> {
	return invoke<ApplyResult>('doc_set_root_text', { handle, text });
}

export function docUndo(handle: DocHandle): Promise<ApplyResult | null> {
	return invoke<ApplyResult | null>('doc_undo', { handle });
}

export function docRedo(handle: DocHandle): Promise<ApplyResult | null> {
	return invoke<ApplyResult | null>('doc_redo', { handle });
}

export function docDiff(left: DocHandle, right: DocHandle): Promise<DiffEntry[]> {
	return invoke<DiffEntry[]>('doc_diff', { left, right });
}

export function docSearch(
	handle: DocHandle,
	opts: SearchOptions,
	jobId?: string,
): Promise<SearchHit[]> {
	return invoke<SearchHit[]>('doc_search', { handle, opts, jobId });
}

export function cancelJob(jobId: string): Promise<boolean> {
	return invoke<boolean>('cancel_job', { jobId });
}

export interface ReplaceResult {
	count: number;
	applied: ApplyResult | null;
}

export function docReplace(
	handle: DocHandle,
	query: string,
	replacement: string,
	caseSensitive: boolean,
): Promise<ReplaceResult> {
	return invoke<ReplaceResult>('doc_replace', { handle, query, replacement, caseSensitive });
}

export function docRepairText(text: string): Promise<RepairResult> {
	return invoke<RepairResult>('doc_repair_text', { text });
}

export function docValidateSchema(
	handle: DocHandle,
	schema: string,
): Promise<SchemaValidationResult> {
	return invoke<SchemaValidationResult>('doc_validate_schema', { handle, schema });
}

export function docGenerateTypes(
	handle: DocHandle,
	lang: TypegenLang,
	typeName: string,
): Promise<string> {
	return invoke<string>('doc_generate_types', { handle, lang, typeName });
}

export function docDetectAndConvert(text: string): Promise<DetectResult> {
	return invoke<DetectResult>('doc_detect_and_convert', { text });
}

export function docHistory(handle: DocHandle): Promise<HistoryView> {
	return invoke<HistoryView>('doc_history', { handle });
}

export function docSave(handle: DocHandle, path?: string): Promise<SaveResult> {
	return invoke<SaveResult>('doc_save', { handle, path: path ?? null });
}

export function docSetFilePath(handle: DocHandle, path: string): Promise<Summary> {
	return invoke<Summary>('doc_set_file_path', { handle, path });
}

export function docBackup(handle: DocHandle, displayName: string | null): Promise<boolean> {
	return invoke<boolean>('doc_backup', { handle, displayName });
}

export function docBackupClear(docId: string): Promise<void> {
	return invoke<void>('doc_backup_clear', { docId });
}

export function docBackupScan(): Promise<BackupRecord[]> {
	return invoke<BackupRecord[]>('doc_backup_scan', {});
}

export function docExport(handle: DocHandle, format: ExportFormat): Promise<string> {
	return invoke<string>('doc_export', { handle, format });
}

export interface ExportPreview {
	text: string;
	truncated: boolean;
}

export function docExportPreview(
	handle: DocHandle,
	format: ExportFormat,
	maxChars: number,
): Promise<ExportPreview> {
	return invoke<ExportPreview>('doc_export_preview', { handle, format, maxChars });
}

export function docExportToFile(
	handle: DocHandle,
	format: ExportFormat,
	path: string,
): Promise<void> {
	return invoke<void>('doc_export_to_file', { handle, format, path });
}
