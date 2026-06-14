import { describe, it, expect } from 'vitest';
import { unifiedDiff, changeCounts, changeAnchors, type UnifiedRow, type GapRow } from './linediff';

function sum(rows: UnifiedRow[]): string[] {
	return rows.map((r) => {
		if (r.type === 'gap') return `gap:${r.count}`;
		return `${r.type}:${r.text}(${r.leftNo ?? '_'},${r.rightNo ?? '_'})`;
	});
}

describe('unifiedDiff — basics', () => {
	it('returns no rows for identical text', () => {
		expect(unifiedDiff('a\nb\nc', 'a\nb\nc')).toEqual([]);
	});

	it('renders a single-line replace as del + add with correct line numbers', () => {
		expect(sum(unifiedDiff('a\nb\nc', 'a\nX\nc', 3))).toEqual([
			'context:a(1,1)',
			'del:b(2,_)',
			'add:X(_,2)',
			'context:c(3,3)',
		]);
	});

	it('keeps surrounding lines as context for a pure insertion (LCS, not del+add all)', () => {
		expect(sum(unifiedDiff('a\nc', 'a\nb\nc', 3))).toEqual([
			'context:a(1,1)',
			'add:b(_,2)',
			'context:c(2,3)',
		]);
	});

	it('renders a pure deletion, with right-side numbering continuing past it', () => {
		expect(sum(unifiedDiff('a\nb\nc', 'a\nc', 3))).toEqual([
			'context:a(1,1)',
			'del:b(2,_)',
			'context:c(3,2)',
		]);
	});
});

describe('unifiedDiff — context collapsing', () => {
	it('collapses leading and trailing context into gaps, keeping `ctx` lines', () => {
		const rows = unifiedDiff('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nX\ne\nf\ng', 1);
		expect(sum(rows)).toEqual([
			'gap:2',
			'context:c(3,3)',
			'del:d(4,_)',
			'add:X(_,4)',
			'context:e(5,5)',
			'gap:2',
		]);
		// the hidden lines are carried on the gap for expand-on-click
		expect((rows[0] as GapRow).lines.map((l) => l.text)).toEqual(['a', 'b']);
		expect((rows[rows.length - 1] as GapRow).lines.map((l) => l.text)).toEqual(['f', 'g']);
	});

	it('collapses a long context run *between* two changes into a middle gap', () => {
		expect(sum(unifiedDiff('X\nb\nc\nd\nY\nf', 'A\nb\nc\nd\nB\nf', 1))).toEqual([
			'del:X(1,_)',
			'add:A(_,1)',
			'context:b(2,2)',
			'gap:1',
			'context:d(4,4)',
			'del:Y(5,_)',
			'add:B(_,5)',
			'context:f(6,6)',
		]);
	});

	it('does not collapse a middle context run shorter than 2×ctx', () => {
		expect(sum(unifiedDiff('X\nb\nc\nY\nf', 'A\nb\nc\nB\nf', 2))).toEqual([
			'del:X(1,_)',
			'add:A(_,1)',
			'context:b(2,2)',
			'context:c(3,3)',
			'del:Y(4,_)',
			'add:B(_,4)',
			'context:f(5,5)',
		]);
	});
});

describe('changeCounts', () => {
	it('counts top-level add/del rows only (gap-hidden context is not counted)', () => {
		const rows = unifiedDiff('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nX\ne\nf\ng', 1);
		expect(changeCounts(rows)).toEqual({ adds: 1, dels: 1 });
	});
	it('is zero for identical text', () => {
		expect(changeCounts(unifiedDiff('a\nb', 'a\nb'))).toEqual({ adds: 0, dels: 0 });
	});
});

describe('changeAnchors', () => {
	it('marks the first index of each change run', () => {
		const rows = unifiedDiff('X\nb\nc\nd\nY\nf', 'A\nb\nc\nd\nB\nf', 1);
		// rows: [del,add,ctx,gap,ctx,del,add,ctx] → runs start at 0 and 5
		expect(changeAnchors(rows)).toEqual([0, 5]);
	});
	it('chunks a long unbroken change run every 50 rows', () => {
		const make = (n: number): UnifiedRow[] =>
			Array.from({ length: n }, (_, i) => ({
				type: 'add',
				text: 'x',
				leftNo: null,
				rightNo: i + 1,
			}));
		expect(changeAnchors(make(60))).toEqual([0, 50]);
		expect(changeAnchors(make(150))).toEqual([0, 50, 100]);
	});
	it('returns no anchors when there are no changes', () => {
		expect(changeAnchors(unifiedDiff('a\nb', 'a\nb'))).toEqual([]);
	});
});
