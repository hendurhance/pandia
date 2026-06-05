export type DocHandle = string; // uuid v4 (transparent newtype on the Rust side)

export type PathSegment = string | number; // string = object key, number = array index
export type Path = PathSegment[];

export type NodeKind = 'object' | 'array' | 'string' | 'number' | 'bool' | 'null';

export interface NodeView {
	key: PathSegment;
	kind: NodeKind;
	preview: string;
	childCount: number | null;
	sizeHint: number;
}

export interface Summary {
	rootKind: NodeKind;
	rootChildCount: number | null;
	sourcePath: string | null;
	sourceSize: number;
	lazy: boolean;
	version: number;
	
	dirty: boolean;
	
	fileBacked: boolean;
}

export interface SaveResult {
	path: string;
	version: number;
}

export type OpenSource =
	| { kind: 'file'; path: string }
	| { kind: 'text'; text: string; name: string | null };

export interface OpenResult {
	handle: DocHandle;
	summary: Summary;
}

export type WireNumber =
	| { kind: 'safe'; value: number }
	| { kind: 'bigInt'; value: string }
	| { kind: 'bigDecimal'; value: string };

export type Op =
	| { kind: 'setValue'; path: Path; value: unknown }
	| { kind: 'renameKey'; path: Path; from: string; to: string }
	| {
			kind: 'insertKey';
			path: Path;
			key: string;
			value: unknown;
			position: number | null;
	  }
	| { kind: 'deleteKey'; path: Path; key: string }
	| { kind: 'insertItem'; path: Path; index: number; value: unknown }
	| { kind: 'deleteItem'; path: Path; index: number }
	| { kind: 'moveItem'; path: Path; from: number; to: number }
	| { kind: 'reorderKeys'; path: Path; order: string[] }
	| { kind: 'sortKeys'; path: Path; descending: boolean };

export interface ApplyResult {
	version: number;
	inverse: Op;
	affectedPaths: Path[];
}

export type GridUnsuitableReason = 'not-array' | 'empty' | 'non-object-elements' | 'too-divergent';

export interface Column {
	key: string;
	kinds: NodeKind[];
	dominantKind: NodeKind;
	presence: number; // 0..1
	nullable: boolean;
}

export interface ColumnSchema {
	gridSuitable: boolean;
	reason?: GridUnsuitableReason;
	rowCount: number;
	sampled: number;
	columns: Column[];
}

export type DiffKind = 'added' | 'removed' | 'changed' | 'moved';

export interface DiffEntry {
	path: Path;
	kind: DiffKind;
	leftPreview?: string;
	rightPreview?: string;
	
	fromIndex?: number;
}

export type MatchField = 'key' | 'value';

export interface SearchHit {
	path: Path;
	kind: NodeKind;
	matchField: MatchField;
	snippet: string;
}

export interface SearchOptions {
	query: string;
	caseSensitive?: boolean;
	
	maxResults?: number;
}

export interface RepairResult {
	success: boolean;
	repairedJson: string;
	errors: string[];
	warnings: string[];
	originalLength: number;
	repairedLength: number;
	wasUnescaped: boolean;
	cleanedUp: boolean;
}

export interface SchemaError {
	instancePath: string;
	schemaPath: string;
	message: string;
}

export interface SchemaValidationResult {
	valid: boolean;
	errors: SchemaError[];
	errorCount: number;
	truncated: boolean;
}

export type TypegenLang =
	| 'typescript'
	| 'rust'
	| 'go'
	| 'kotlin'
	| 'json-schema'
	| 'python'
	| 'php'
	| 'java'
	| 'zod';

export type DetectKind = 'json' | 'yaml' | 'xml' | 'csv' | 'curl' | 'unknown';

export interface DetectResult {
	kind: DetectKind;
	json: string;
	error: string | null;
}

export interface OpDescription {
	label: string;
	pathDisplay: string;
}

export interface HistoryView {
	undo: OpDescription[]; // oldest → newest (past)
	redo: OpDescription[]; // next-to-redo first (future)
	cap: number;
}

export type ExportFormat = 'json' | 'json-min' | 'yaml' | 'csv' | 'xml';

export interface BackupRecord {
	docId: string;
	originalPath: string | null;
	displayName: string | null;
	updatedAt: string;
	content: string;
}
