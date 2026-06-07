import type { NodeKind, NodeView, Path, PathSegment } from '$lib/ipc/types';

export interface ContentRow {
	variant: 'content';
	path: Path;
	depth: number;
	key: PathSegment;
	kind: NodeKind;
	preview: string;
	childCount: number | null;
	sizeHint: number;
	expanded: boolean;
}

export interface CloseRow {
	variant: 'close';
	depth: number;
	bracket: '}' | ']';
	parentPath: Path;
}

export interface PlaceholderRow {
	variant: 'placeholder';
	parentPath: Path;
	depth: number;
	index: number; // position within parent's children
}

export interface VirtualGapRow {
	variant: 'vgap';
	parentPath: Path;
	depth: number; // = parent.depth + 1 (children level)
	fromIndex: number; // first un-materialized item index (inclusive)
	toIndex: number; // last + 1 (exclusive); count = toIndex - fromIndex
}

export type Row = ContentRow | CloseRow | PlaceholderRow | VirtualGapRow;

export function isContent(row: Row): row is ContentRow {
	return row.variant === 'content';
}

export function isPlaceholder(row: Row): row is PlaceholderRow {
	return row.variant === 'placeholder';
}

export function isVGap(row: Row): row is VirtualGapRow {
	return row.variant === 'vgap';
}

export function vgapCount(row: VirtualGapRow): number {
	return row.toIndex - row.fromIndex;
}

export function isExpandable(row: Row): boolean {
	if (row.variant !== 'content') return false;
	if (row.kind !== 'object' && row.kind !== 'array') return false;
	if (row.childCount === 0) return false;
	return true;
}

export function rootRow(rootKind: NodeKind, rootChildCount: number | null): ContentRow {
	return {
		variant: 'content',
		path: [],
		depth: 0,
		key: '$',
		kind: rootKind,
		preview: rootKind === 'array' ? '[…]' : '{…}',
		childCount: rootChildCount,
		sizeHint: 0,
		expanded: false,
	};
}

export function viewToRow(view: NodeView, parentPath: Path, parentDepth: number): ContentRow {
	return {
		variant: 'content',
		path: [...parentPath, view.key],
		depth: parentDepth + 1,
		key: view.key,
		kind: view.kind,
		preview: view.preview,
		childCount: view.childCount,
		sizeHint: view.sizeHint,
		expanded: false,
	};
}

function makePlaceholders(
	parentPath: Path,
	depth: number,
	startIdx: number,
	endIdx: number,
): PlaceholderRow[] {
	const result: PlaceholderRow[] = [];
	for (let i = startIdx; i < endIdx; i++) {
		result.push({
			variant: 'placeholder',
			parentPath,
			depth: depth + 1,
			index: i,
		});
	}
	return result;
}

export function insertChildrenWithClose(
	rows: Row[],
	parentIndex: number,
	children: ContentRow[],
	totalCount: number | null,
): Row[] {
	const parent = rows[parentIndex];
	if (parent.variant !== 'content') return rows;

	const additions: Row[] = [...children];

	if (totalCount !== null && children.length < totalCount) {
		const gap: VirtualGapRow = {
			variant: 'vgap',
			parentPath: parent.path,
			depth: parent.depth + 1,
			fromIndex: children.length,
			toIndex: totalCount,
		};
		additions.push(gap);
	}

	const closeRow: CloseRow = {
		variant: 'close',
		depth: parent.depth,
		bracket: parent.kind === 'array' ? ']' : '}',
		parentPath: parent.path,
	};
	additions.push(closeRow);

	rows.splice(parentIndex + 1, 0, ...additions);
	return rows;
}

export function expandGapWindow(
	rows: Row[],
	gapIndex: number,
	fromIdx: number,
	toIdx: number,
): number {
	const gap = rows[gapIndex];
	if (gap.variant !== 'vgap') return 0;
	const from = Math.max(fromIdx, gap.fromIndex);
	const to = Math.min(toIdx, gap.toIndex);
	if (to <= from) return 0;

	const replacement: Row[] = [];
	if (from > gap.fromIndex) {
		replacement.push({
			variant: 'vgap',
			parentPath: gap.parentPath,
			depth: gap.depth,
			fromIndex: gap.fromIndex,
			toIndex: from,
		});
	}
	replacement.push(...makePlaceholders(gap.parentPath, gap.depth - 1, from, to));
	if (to < gap.toIndex) {
		replacement.push({
			variant: 'vgap',
			parentPath: gap.parentPath,
			depth: gap.depth,
			fromIndex: to,
			toIndex: gap.toIndex,
		});
	}

	rows.splice(gapIndex, 1, ...replacement);
	return to - from;
}

export function removeSubtree(rows: Row[], parentIndex: number): Row[] {
	const parent = rows[parentIndex];
	if (parent.variant !== 'content') return rows;
	const parentDepth = parent.depth;
	let end = parentIndex + 1;
	while (end < rows.length) {
		const r = rows[end];
		if (r.variant === 'close' && r.depth === parentDepth) {
			end++;
			break;
		}
		const rowDepth = r.variant === 'close' ? r.depth : r.depth;
		if (rowDepth <= parentDepth) break;
		end++;
	}
	rows.splice(parentIndex + 1, end - parentIndex - 1);
	return rows;
}

export function replacePlaceholders(
	rows: Row[],
	parentPath: Path,
	startIdx: number,
	newRows: ContentRow[],
): number {
	const parentKey = pathKey(parentPath);

	let begin = -1;
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (
			r.variant === 'placeholder' &&
			pathKey(r.parentPath) === parentKey &&
			r.index === startIdx
		) {
			begin = i;
			break;
		}
	}
	if (begin < 0) return 0;

	let runLen = 0;
	while (runLen < newRows.length && begin + runLen < rows.length) {
		const r = rows[begin + runLen];
		if (
			r.variant !== 'placeholder' ||
			pathKey(r.parentPath) !== parentKey ||
			r.index !== startIdx + runLen
		) {
			break;
		}
		runLen++;
	}
	if (runLen === 0) return 0;

	rows.splice(begin, runLen, ...newRows.slice(0, runLen));
	return runLen;
}

export function pathKey(path: Path): string {
	return JSON.stringify(path);
}

export function rowKey(row: Row): string {
	if (row.variant === 'close') return pathKey(row.parentPath) + '/__close';
	if (row.variant === 'placeholder') return pathKey(row.parentPath) + '/__ph/' + row.index;
	if (row.variant === 'vgap')
		return pathKey(row.parentPath) + '/__vgap/' + row.fromIndex + '-' + row.toIndex;
	return pathKey(row.path);
}

export type MenuAction =
	| 'edit-key'
	| 'edit-value'
	| 'cut'
	| 'copy'
	| 'copy-path'
	| 'paste'
	| 'extract'
	| 'insert-before'
	| 'insert-after'
	| 'duplicate'
	| 'move-up'
	| 'move-down'
	| 'sort-keys-asc'
	| 'sort-keys-desc'
	| 'remove'
	| 'convert-string'
	| 'convert-number'
	| 'convert-boolean'
	| 'convert-null';
