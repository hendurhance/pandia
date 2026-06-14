import { describe, it, expect } from 'vitest';
import {
	insertChildrenWithClose,
	expandGapWindow,
	removeSubtree,
	replacePlaceholders,
	isExpandable,
	vgapCount,
	pathKey,
	rowKey,
	rootRow,
	viewToRow,
	type ContentRow,
	type CloseRow,
	type PlaceholderRow,
	type VirtualGapRow,
	type Row,
} from './model';
import type { NodeView, Path } from '$lib/ipc/types';

function content(path: Path, depth: number, opts: Partial<ContentRow> = {}): ContentRow {
	return {
		variant: 'content',
		path,
		depth,
		key: path.length ? path[path.length - 1] : '$',
		kind: 'object',
		preview: '',
		childCount: null,
		sizeHint: 0,
		expanded: false,
		...opts,
	};
}
const closeRow = (parentPath: Path, depth: number, bracket: '}' | ']' = '}'): CloseRow => ({
	variant: 'close',
	depth,
	bracket,
	parentPath,
});
const ph = (parentPath: Path, depth: number, index: number): PlaceholderRow => ({
	variant: 'placeholder',
	parentPath,
	depth,
	index,
});
const gap = (
	parentPath: Path,
	depth: number,
	fromIndex: number,
	toIndex: number,
): VirtualGapRow => ({
	variant: 'vgap',
	parentPath,
	depth,
	fromIndex,
	toIndex,
});

function shape(rows: Row[]): string[] {
	return rows.map((r) => {
		if (r.variant === 'content') return `c:${pathKey(r.path)}@${r.depth}`;
		if (r.variant === 'close') return `x:${r.bracket}@${r.depth}`;
		if (r.variant === 'placeholder') return `p:${r.index}@${r.depth}`;
		return `g:${r.fromIndex}-${r.toIndex}@${r.depth}`;
	});
}
const phRange = (a: number, b: number, depth = 1): string[] =>
	Array.from({ length: b - a }, (_, i) => `p:${a + i}@${depth}`);

describe('isExpandable', () => {
	it('is true for objects/arrays with children or unknown count', () => {
		expect(isExpandable(content(['a'], 0, { kind: 'object', childCount: 3 }))).toBe(true);
		expect(isExpandable(content(['a'], 0, { kind: 'array', childCount: null }))).toBe(true);
	});
	it('is false for an empty container, scalars, and non-content rows', () => {
		expect(isExpandable(content(['a'], 0, { kind: 'object', childCount: 0 }))).toBe(false);
		expect(isExpandable(content(['a'], 0, { kind: 'string' }))).toBe(false);
		expect(isExpandable(content(['a'], 0, { kind: 'number', childCount: 5 }))).toBe(false);
		expect(isExpandable(closeRow([], 0))).toBe(false);
	});
});

describe('vgapCount', () => {
	it('is the half-open span', () => {
		expect(vgapCount(gap(['a'], 1, 2, 7))).toBe(5);
		expect(vgapCount(gap(['a'], 1, 0, 0))).toBe(0);
	});
});

describe('rowKey', () => {
	it('disambiguates the four variants sharing a parent path', () => {
		const p: Path = ['a'];
		const keys = [
			rowKey(content(['a'], 0)),
			rowKey(closeRow(p, 0)),
			rowKey(ph(p, 1, 0)),
			rowKey(ph(p, 1, 1)),
			rowKey(gap(p, 1, 0, 5)),
		];
		expect(new Set(keys).size).toBe(keys.length); // all distinct
		expect(rowKey(content(['a'], 0))).toBe(pathKey(['a']));
	});
});

describe('rootRow / viewToRow', () => {
	it('rootRow is a collapsed depth-0 row keyed $', () => {
		const r = rootRow('array', 9);
		expect(r).toMatchObject({ depth: 0, key: '$', kind: 'array', childCount: 9, expanded: false });
		expect(r.path).toEqual([]);
	});
	it('viewToRow appends the key and sits at parentDepth + 1', () => {
		const view: NodeView = {
			key: 'x',
			kind: 'number',
			preview: '42',
			childCount: null,
			sizeHint: 2,
		};
		expect(viewToRow(view, ['a'], 0)).toMatchObject({
			path: ['a', 'x'],
			depth: 1,
			key: 'x',
			kind: 'number',
			expanded: false,
		});
	});
});

describe('insertChildrenWithClose', () => {
	it('inserts loaded children + close for a fully-loaded object (no gap)', () => {
		const rows: Row[] = [content(['a'], 0, { childCount: 2 })];
		insertChildrenWithClose(rows, 0, [content(['a', 'x'], 1), content(['a', 'y'], 1)], 2);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["a","x"]@1', 'c:["a","y"]@1', 'x:}@0']);
	});
	it('appends a vgap for the unloaded remainder and uses ] for arrays', () => {
		const rows: Row[] = [content(['a'], 0, { kind: 'array', childCount: 5 })];
		insertChildrenWithClose(rows, 0, [content(['a', 0], 1), content(['a', 1], 1)], 5);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["a",0]@1', 'c:["a",1]@1', 'g:2-5@1', 'x:]@0']);
	});
	it('omits the gap when totalCount is null', () => {
		const rows: Row[] = [content(['a'], 0)];
		insertChildrenWithClose(rows, 0, [content(['a', 'x'], 1)], null);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["a","x"]@1', 'x:}@0']);
	});
	it('emits a gap covering everything when nothing is loaded yet', () => {
		const rows: Row[] = [content(['a'], 0, { kind: 'array', childCount: 3 })];
		insertChildrenWithClose(rows, 0, [], 3);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'g:0-3@1', 'x:]@0']);
	});
	it('inserts directly after the parent without clobbering following siblings', () => {
		const rows: Row[] = [content(['a'], 0, { childCount: 1 }), content(['b'], 0)];
		insertChildrenWithClose(rows, 0, [content(['a', 'x'], 1)], 1);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["a","x"]@1', 'x:}@0', 'c:["b"]@0']);
	});
	it('is a no-op when the target index is not a content row', () => {
		const rows: Row[] = [closeRow([], 0)];
		insertChildrenWithClose(rows, 0, [content(['x'], 1)], 1);
		expect(shape(rows)).toEqual(['x:}@0']);
	});
});

describe('expandGapWindow', () => {
	it('materializes a middle window, leaving leading + trailing gaps', () => {
		const rows: Row[] = [gap(['a'], 1, 0, 100)];
		const n = expandGapWindow(rows, 0, 40, 60);
		expect(n).toBe(20);
		expect(shape(rows)).toEqual(['g:0-40@1', ...phRange(40, 60), 'g:60-100@1']);
	});
	it('clamps the window to the gap and drops both gaps when fully covered', () => {
		const rows: Row[] = [gap(['a'], 1, 10, 20)];
		const n = expandGapWindow(rows, 0, 0, 1000);
		expect(n).toBe(10);
		expect(shape(rows)).toEqual(phRange(10, 20));
	});
	it('drops only the leading gap when the window starts at the gap start', () => {
		const rows: Row[] = [gap(['a'], 1, 0, 50)];
		expect(expandGapWindow(rows, 0, 0, 20)).toBe(20);
		expect(shape(rows)).toEqual([...phRange(0, 20), 'g:20-50@1']);
	});
	it('drops only the trailing gap when the window ends at the gap end', () => {
		const rows: Row[] = [gap(['a'], 1, 0, 50)];
		expect(expandGapWindow(rows, 0, 30, 50)).toBe(20);
		expect(shape(rows)).toEqual(['g:0-30@1', ...phRange(30, 50)]);
	});
	it('returns 0 and leaves the gap intact when the window misses it', () => {
		const rows: Row[] = [gap(['a'], 1, 10, 20)];
		expect(expandGapWindow(rows, 0, 0, 5)).toBe(0);
		expect(shape(rows)).toEqual(['g:10-20@1']);
	});
	it('returns 0 when the target row is not a vgap', () => {
		const rows: Row[] = [content(['a'], 0)];
		expect(expandGapWindow(rows, 0, 0, 5)).toBe(0);
		expect(shape(rows)).toEqual(['c:["a"]@0']);
	});
});

describe('removeSubtree', () => {
	it('removes children and the matching close, leaving the parent', () => {
		const rows: Row[] = [
			content(['a'], 0, { expanded: true }),
			content(['a', 'x'], 1),
			content(['a', 'y'], 1),
			closeRow(['a'], 0),
		];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0']);
	});
	it('removes a nested subtree including inner closes', () => {
		const rows: Row[] = [
			content(['a'], 0),
			content(['a', 'b'], 1),
			content(['a', 'b', 'c'], 2),
			closeRow(['a', 'b'], 1),
			closeRow(['a'], 0),
		];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0']);
	});
	it('preserves rows that follow the subtree', () => {
		const rows: Row[] = [
			content(['a'], 0),
			content(['a', 'x'], 1),
			closeRow(['a'], 0),
			content(['b'], 0),
		];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["b"]@0']);
	});
	it('is a no-op when the next row is a same-depth sibling', () => {
		const rows: Row[] = [content(['a'], 0), content(['b'], 0)];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["b"]@0']);
	});
	it('is a no-op at the end of the array', () => {
		const rows: Row[] = [content(['a'], 0)];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0']);
	});
	it('removes a partially-loaded subtree (placeholders + gap + close)', () => {
		const rows: Row[] = [
			content(['a'], 0, { kind: 'array' }),
			ph(['a'], 1, 0),
			gap(['a'], 1, 1, 9),
			closeRow(['a'], 0, ']'),
		];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['c:["a"]@0']);
	});
	it('is a no-op when the target is not a content row', () => {
		const rows: Row[] = [closeRow([], 0), content(['a'], 1)];
		removeSubtree(rows, 0);
		expect(shape(rows)).toEqual(['x:}@0', 'c:["a"]@1']);
	});
});

describe('replacePlaceholders', () => {
	it('replaces a contiguous run starting at startIdx, keeping extra placeholders', () => {
		const rows: Row[] = [ph(['a'], 1, 0), ph(['a'], 1, 1), ph(['a'], 1, 2)];
		const n = replacePlaceholders(rows, ['a'], 0, [content(['a', 0], 1), content(['a', 1], 1)]);
		expect(n).toBe(2);
		expect(shape(rows)).toEqual(['c:["a",0]@1', 'c:["a",1]@1', 'p:2@1']);
	});
	it('caps replacement at the available placeholder run length', () => {
		const rows: Row[] = [ph(['a'], 1, 0), ph(['a'], 1, 1)];
		const n = replacePlaceholders(rows, ['a'], 0, [
			content(['a', 0], 1),
			content(['a', 1], 1),
			content(['a', 2], 1),
		]);
		expect(n).toBe(2);
		expect(shape(rows)).toEqual(['c:["a",0]@1', 'c:["a",1]@1']);
	});
	it('stops the run at a non-consecutive index', () => {
		const rows: Row[] = [ph(['a'], 1, 0), ph(['a'], 1, 2)];
		const n = replacePlaceholders(rows, ['a'], 0, [content(['a', 0], 1), content(['a', 1], 1)]);
		expect(n).toBe(1);
		expect(shape(rows)).toEqual(['c:["a",0]@1', 'p:2@1']);
	});
	it('matches only the requested parent path', () => {
		const rows: Row[] = [ph(['a'], 1, 0), ph(['b'], 1, 0)];
		const n = replacePlaceholders(rows, ['b'], 0, [content(['b', 0], 1)]);
		expect(n).toBe(1);
		expect(shape(rows)).toEqual(['p:0@1', 'c:["b",0]@1']);
	});
	it('finds a placeholder run that is not at the array start', () => {
		const rows: Row[] = [content(['a'], 0), ph(['a'], 1, 0), closeRow(['a'], 0)];
		const n = replacePlaceholders(rows, ['a'], 0, [content(['a', 0], 1)]);
		expect(n).toBe(1);
		expect(shape(rows)).toEqual(['c:["a"]@0', 'c:["a",0]@1', 'x:}@0']);
	});
	it('returns 0 when there is no placeholder at startIdx', () => {
		const rows: Row[] = [ph(['a'], 1, 1), ph(['a'], 1, 2)];
		const n = replacePlaceholders(rows, ['a'], 0, [content(['a', 0], 1)]);
		expect(n).toBe(0);
		expect(shape(rows)).toEqual(['p:1@1', 'p:2@1']);
	});
});
