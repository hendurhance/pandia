import { describe, it, expect } from 'vitest';
import {
	unifiedRows,
	gapRows,
	changeCounts,
	changeAnchors,
	type UnifiedRow,
	type GapRow,
} from './linediff';
import type { LineDiffResult, LineHunk } from '$lib/ipc/bindings';

function hunk(leftStart: number, leftLen: number, rightStart: number, rightLen: number): LineHunk {
	return { leftStart, leftLen, rightStart, rightLen };
}

function diff(hunks: LineHunk[], leftLines: number, rightLines: number): LineDiffResult {
	return { hunks, leftLines, rightLines };
}

function sum(rows: UnifiedRow[]): string[] {
	return rows.map((r) => {
		if (r.type === 'gap') return `gap:${r.count}`;
		return `${r.type}:(${r.leftNo ?? '_'},${r.rightNo ?? '_'})`;
	});
}

describe('unifiedRows — basics', () => {
	it('returns no rows when there are no hunks', () => {
		expect(unifiedRows(diff([], 3, 3))).toEqual([]);
	});

	it('renders a single-line replace as del + add with correct line numbers', () => {
		expect(sum(unifiedRows(diff([hunk(1, 1, 1, 1)], 3, 3)))).toEqual([
			'context:(1,1)',
			'del:(2,_)',
			'add:(_,2)',
			'context:(3,3)',
		]);
	});

	it('renders a pure insertion with surrounding context', () => {
		expect(sum(unifiedRows(diff([hunk(1, 0, 1, 1)], 2, 3)))).toEqual([
			'context:(1,1)',
			'add:(_,2)',
			'context:(2,3)',
		]);
	});

	it('renders a pure deletion, with right-side numbering continuing past it', () => {
		expect(sum(unifiedRows(diff([hunk(1, 1, 1, 0)], 3, 2)))).toEqual([
			'context:(1,1)',
			'del:(2,_)',
			'context:(3,2)',
		]);
	});
});

describe('unifiedRows — context collapsing', () => {
	it('collapses leading and trailing context into gaps, keeping `ctx` lines', () => {
		const rows = unifiedRows(diff([hunk(3, 1, 3, 1)], 7, 7), 1);
		expect(sum(rows)).toEqual([
			'gap:2',
			'context:(3,3)',
			'del:(4,_)',
			'add:(_,4)',
			'context:(5,5)',
			'gap:2',
		]);
		expect(rows[0]).toEqual({ type: 'gap', count: 2, leftStart: 0, rightStart: 0 });
		expect(rows[rows.length - 1]).toEqual({ type: 'gap', count: 2, leftStart: 5, rightStart: 5 });
	});

	it('collapses a long context run *between* two changes into a middle gap', () => {
		expect(sum(unifiedRows(diff([hunk(0, 1, 0, 1), hunk(4, 1, 4, 1)], 6, 6), 1))).toEqual([
			'del:(1,_)',
			'add:(_,1)',
			'context:(2,2)',
			'gap:1',
			'context:(4,4)',
			'del:(5,_)',
			'add:(_,5)',
			'context:(6,6)',
		]);
	});

	it('does not collapse a middle context run shorter than 2×ctx', () => {
		expect(sum(unifiedRows(diff([hunk(0, 1, 0, 1), hunk(3, 1, 3, 1)], 5, 5), 2))).toEqual([
			'del:(1,_)',
			'add:(_,1)',
			'context:(2,2)',
			'context:(3,3)',
			'del:(4,_)',
			'add:(_,4)',
			'context:(5,5)',
		]);
	});
});

describe('gapRows', () => {
	it('expands a gap into context rows numbered from its start lines', () => {
		const gap: GapRow = { type: 'gap', count: 3, leftStart: 4, rightStart: 6 };
		expect(sum(gapRows(gap))).toEqual(['context:(5,7)', 'context:(6,8)', 'context:(7,9)']);
	});
});

describe('changeCounts', () => {
	it('sums added and deleted lines across hunks', () => {
		expect(changeCounts([hunk(1, 1, 1, 2), hunk(9, 3, 10, 0)])).toEqual({ adds: 2, dels: 4 });
	});
	it('is zero without hunks', () => {
		expect(changeCounts([])).toEqual({ adds: 0, dels: 0 });
	});
});

describe('changeAnchors', () => {
	it('marks the first index of each change run', () => {
		const rows = unifiedRows(diff([hunk(0, 1, 0, 1), hunk(4, 1, 4, 1)], 6, 6), 1);
		// rows: [del,add,ctx,gap,ctx,del,add,ctx] → runs start at 0 and 5
		expect(changeAnchors(rows)).toEqual([0, 5]);
	});
	it('chunks a long unbroken change run every 50 rows', () => {
		const make = (n: number): UnifiedRow[] =>
			Array.from({ length: n }, (_, i) => ({
				type: 'add',
				leftNo: null,
				rightNo: i + 1,
			}));
		expect(changeAnchors(make(60))).toEqual([0, 50]);
		expect(changeAnchors(make(150))).toEqual([0, 50, 100]);
	});
	it('returns no anchors when there are no changes', () => {
		expect(changeAnchors(unifiedRows(diff([], 2, 2)))).toEqual([]);
	});
});
