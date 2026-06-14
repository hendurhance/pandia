import { invoke } from '@tauri-apps/api/core';
import { parseLossless } from '$lib/util/lossless';
import { toIpcError } from './error';
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

export { IpcError, type IpcErrorKind } from './error';

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	const pending = invoke<T>(cmd, args);
	return pending.catch((e: unknown) => {
		throw toIpcError(e);
	});
}

export function docOpen(source: OpenSource): Promise<OpenResult> {
	return call<OpenResult>('doc_open', { source });
}

export function docClose(handle: DocHandle): Promise<boolean> {
	return call<boolean>('doc_close', { handle });
}

export function docGetSlice(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
): Promise<NodeView[]> {
	return call<NodeView[]>('doc_get_slice', { handle, path, start, end });
}

export function docGetValue(handle: DocHandle, path: Path): Promise<unknown> {
	return call<unknown>('doc_get_value', { handle, path });
}

export function docValueJson(handle: DocHandle, path: Path): Promise<string> {
	return call<string>('doc_value_json', { handle, path });
}

export function docGetRows(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
): Promise<unknown[]> {
	return call<string[]>('doc_get_rows', { handle, path, start, end }).then((rows) =>
		rows.map(parseLossless),
	);
}

export interface SortedRow {
	index: number;
	value: unknown;
}

interface WireRow {
	index: number;
	value: string;
}

export function docGetRowsSorted(
	handle: DocHandle,
	path: Path,
	start: number,
	end: number,
	key: string,
	descending: boolean,
): Promise<SortedRow[]> {
	return call<WireRow[]>('doc_get_rows_sorted', {
		handle,
		path,
		start,
		end,
		key,
		descending,
	}).then((rows) => rows.map((r) => ({ index: r.index, value: parseLossless(r.value) })));
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
	return call<{ total: number; rows: WireRow[] }>('doc_get_rows_filtered', {
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
	}).then((fr) => ({
		total: fr.total,
		rows: fr.rows.map((r) => ({ index: r.index, value: parseLossless(r.value) })),
	}));
}

export interface ColumnValue {
	value: unknown;
	count: number;
	label?: string | null;
}
export interface ColumnValues {
	values: ColumnValue[];

	capped: boolean;
}

export function docGetRowsAt(handle: DocHandle, path: Path, indices: number[]): Promise<string> {
	return call<string>('doc_get_rows_at', { handle, path, indices });
}

export function docColumnValues(
	handle: DocHandle,
	path: Path,
	key: string,
	limit: number,
): Promise<ColumnValues> {
	return call<ColumnValues>('doc_column_values', { handle, path, key, limit });
}

export function docSummary(handle: DocHandle): Promise<Summary> {
	return call<Summary>('doc_summary', { handle });
}

export function docChildCount(handle: DocHandle, path: Path): Promise<number | null> {
	return call<number | null>('doc_child_count', { handle, path });
}

export function docColumnSchema(handle: DocHandle, path: Path): Promise<ColumnSchema> {
	return call<ColumnSchema>('doc_column_schema', { handle, path });
}

export function docApplyOp(handle: DocHandle, op: Op): Promise<ApplyResult> {
	return call<ApplyResult>('doc_apply_op', { handle, op });
}

export function docSetRootText(handle: DocHandle, text: string): Promise<ApplyResult> {
	return call<ApplyResult>('doc_set_root_text', { handle, text });
}

export function docUndo(handle: DocHandle): Promise<ApplyResult | null> {
	return call<ApplyResult | null>('doc_undo', { handle });
}

export function docRedo(handle: DocHandle): Promise<ApplyResult | null> {
	return call<ApplyResult | null>('doc_redo', { handle });
}

export function docDiff(left: DocHandle, right: DocHandle): Promise<DiffEntry[]> {
	return call<DiffEntry[]>('doc_diff', { left, right });
}

export function docSearch(
	handle: DocHandle,
	opts: SearchOptions,
	jobId?: string,
): Promise<SearchHit[]> {
	return call<SearchHit[]>('doc_search', { handle, opts, jobId });
}

export function cancelJob(jobId: string): Promise<boolean> {
	return call<boolean>('cancel_job', { jobId });
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
	return call<ReplaceResult>('doc_replace', { handle, query, replacement, caseSensitive });
}

export function docRepairText(text: string): Promise<RepairResult> {
	return call<RepairResult>('doc_repair_text', { text });
}

export function docValidateSchema(
	handle: DocHandle,
	schema: string,
): Promise<SchemaValidationResult> {
	return call<SchemaValidationResult>('doc_validate_schema', { handle, schema });
}

export function docGenerateTypes(
	handle: DocHandle,
	lang: TypegenLang,
	typeName: string,
): Promise<string> {
	return call<string>('doc_generate_types', { handle, lang, typeName });
}

export function docDetectAndConvert(text: string): Promise<DetectResult> {
	return call<DetectResult>('doc_detect_and_convert', { text });
}

export function docHistory(handle: DocHandle): Promise<HistoryView> {
	return call<HistoryView>('doc_history', { handle });
}

export function docSave(handle: DocHandle, path?: string): Promise<SaveResult> {
	return call<SaveResult>('doc_save', { handle, path: path ?? null });
}

export function docSetFilePath(handle: DocHandle, path: string): Promise<Summary> {
	return call<Summary>('doc_set_file_path', { handle, path });
}

export function docBackup(handle: DocHandle, displayName: string | null): Promise<boolean> {
	return call<boolean>('doc_backup', { handle, displayName });
}

export function docBackupClear(docId: string): Promise<void> {
	return call<void>('doc_backup_clear', { docId });
}

export function docBackupScan(): Promise<BackupRecord[]> {
	return call<BackupRecord[]>('doc_backup_scan', {});
}

export function docExport(handle: DocHandle, format: ExportFormat): Promise<string> {
	return call<string>('doc_export', { handle, format });
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
	return call<ExportPreview>('doc_export_preview', { handle, format, maxChars });
}

export function docExportToFile(
	handle: DocHandle,
	format: ExportFormat,
	path: string,
): Promise<void> {
	return call<void>('doc_export_to_file', { handle, format, path });
}
