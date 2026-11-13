import { describe, expect, it } from 'vitest';
import { collectExpandedDescendants, pathAfterOp } from './tree-walk';
import type { CloseRow, ContentRow, PlaceholderRow, Row } from './model';
import type { NodeKind, Op, Path } from '$lib/ipc/bindings';

function content(path: Path, depth: number, expanded: boolean): ContentRow {
	return {
		variant: 'content',
		path,
		depth,
		key: path[path.length - 1] ?? '',
		kind: 'object' as NodeKind,
		preview: '',
		childCount: null,
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

describe('pathAfterOp', () => {
	const P: Path = ['list', 2, 'name'];
	it.each<[string, Op, Path | null]>([
		[
			'an earlier item is removed',
			{ kind: 'deleteItem', path: ['list'], index: 0 },
			['list', 1, 'name'],
		],
		['its own item is removed', { kind: 'deleteItem', path: ['list'], index: 2 }, null],
		['a later item is removed', { kind: 'deleteItem', path: ['list'], index: 3 }, P],
		[
			'an item is inserted before it',
			{ kind: 'insertItemText', path: ['list'], index: 2, text: '1' },
			['list', 3, 'name'],
		],
		['its item is duplicated', { kind: 'duplicateItem', path: ['list'], index: 2 }, P],
		[
			'its item is moved',
			{ kind: 'moveItem', path: ['list'], from: 2, to: 0 },
			['list', 0, 'name'],
		],
		[
			'an ancestor key is renamed',
			{ kind: 'renameKey', path: [], from: 'list', to: 'rows' },
			['rows', 2, 'name'],
		],
		['an ancestor key is deleted', { kind: 'deleteKey', path: [], key: 'list' }, null],
		['an ancestor is replaced', { kind: 'setValueText', path: ['list', 2], text: '{}' }, null],
		['the node itself is replaced', { kind: 'setValueText', path: P, text: '"x"' }, null],
		['another key is deleted', { kind: 'deleteKey', path: [], key: 'other' }, P],
		['another array changes', { kind: 'deleteItem', path: ['other'], index: 0 }, P],
		['something inside it changes', { kind: 'deleteKey', path: [...P, 'deep'], key: 'x' }, P],
	])('when %s', (_, op, expected) => {
		expect(pathAfterOp(P, op)).toEqual(expected);
	});
});
