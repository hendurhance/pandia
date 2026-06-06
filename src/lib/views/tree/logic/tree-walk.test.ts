import { describe, expect, it } from 'vitest';
import { collectExpandedDescendants } from './tree-walk';
import type { CloseRow, ContentRow, PlaceholderRow, Row } from './model';
import type { NodeKind, Path } from '$lib/ipc/types';

function content(path: Path, depth: number, expanded: boolean): ContentRow {
	return {
		variant: 'content',
		path,
		depth,
		key: path[path.length - 1] ?? '',
		kind: 'object' as NodeKind,
		preview: '',
		childCount: null,
		sizeHint: 0,
		expanded,
	};
}

function close(parentPath: Path, depth: number): CloseRow {
	return { variant: 'close', depth, bracket: '}', parentPath };
}

function placeholder(parentPath: Path, depth: number, index: number): PlaceholderRow {
	return { variant: 'placeholder', parentPath, depth, index };
}

describe('collectExpandedDescendants', () => {
	it('returns nothing when no descendant is expanded', () => {
		const rows: Row[] = [
			content([], 0, true), // root, expanded
			content(['a'], 1, false),
			content(['b'], 1, false),
			close([], 0),
		];
		expect(collectExpandedDescendants(rows, 0, 0)).toEqual([]);
	});

	it('captures every expanded content row strictly below idx', () => {
		const rows: Row[] = [
			content([], 0, true), // root
			content(['a'], 1, true), // expanded
			content(['a', 'x'], 2, false),
			content(['b'], 1, true), // expanded
			content(['b', 'y'], 2, true), // expanded (deeper)
			close([], 0),
		];
		const paths = collectExpandedDescendants(rows, 0, 0);
		expect(paths).toEqual([['a'], ['b'], ['b', 'y']]);
	});

	it('stops walking at the first row at or above baseDepth (subtree boundary)', () => {
		const rows: Row[] = [
			content([], 0, true),
			content(['a'], 1, true), // ← target
			content(['a', 'x'], 2, true),
			content(['a', 'y'], 2, true),
			close(['a'], 1), // close of 'a' — depth 1 = baseDepth → stop
			content(['b'], 1, true), // not part of the subtree
			close([], 0),
		];
		const paths = collectExpandedDescendants(rows, 1, 1);
		expect(paths).toEqual([
			['a', 'x'],
			['a', 'y'],
		]);
	});

	it('skips placeholder + close + vgap rows (only collects content)', () => {
		const rows: Row[] = [
			content([], 0, true),
			content(['a'], 1, true),
			placeholder(['a'], 2, 0),
			close(['a'], 1),
			close([], 0),
		];
		expect(collectExpandedDescendants(rows, 0, 0)).toEqual([['a']]);
	});

	it('returns empty when idx is the last row', () => {
		const rows: Row[] = [content([], 0, true)];
		expect(collectExpandedDescendants(rows, 0, 0)).toEqual([]);
	});

	it('pre-order: ancestor precedes descendants (so reExpand can walk shallowest-first)', () => {
		const rows: Row[] = [
			content([], 0, true),
			content(['a'], 1, true),
			content(['a', 'x'], 2, true), // grandchild
			content(['a', 'x', 'y'], 3, true), // great-grandchild
			close(['a', 'x'], 2),
			close(['a'], 1),
			close([], 0),
		];
		const paths = collectExpandedDescendants(rows, 0, 0);
		expect(paths).toEqual([['a'], ['a', 'x'], ['a', 'x', 'y']]);
	});
});
