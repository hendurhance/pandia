import { describe, expect, it } from 'vitest';
import { buildOffsets, DEFAULT_ROW_H, indexAtOffset, visibleWindow } from './virtualizer';

describe('buildOffsets', () => {
	it('uniform-height fast path: zero rows', () => {
		const { view } = buildOffsets(0, () => 22, new Float64Array(0), true);
		expect(view.length).toBe(1);
		expect(view[0]).toBe(0);
	});

	it('uniform-height fast path: every row at default', () => {
		const { view } = buildOffsets(5, () => 22, new Float64Array(0), true);
		expect(Array.from(view)).toEqual([0, 22, 44, 66, 88, 110]);
	});

	it('variable-height path consults the heightAt callback', () => {
		const heights = [22, 22, 60, 22, 100]; // row 2 wrapped, row 4 huge
		const { view } = buildOffsets(5, (i) => heights[i], new Float64Array(0), false);
		expect(Array.from(view)).toEqual([0, 22, 44, 104, 126, 226]);
	});

	it('grows the buffer with slack so subsequent calls reuse it', () => {
		const initial = new Float64Array(0);
		const { buf: grew } = buildOffsets(5, () => 22, initial, true);
		expect(grew.length).toBeGreaterThanOrEqual(6);
		expect(grew).not.toBe(initial); // grew → new allocation

		const { buf: same, view } = buildOffsets(3, () => 22, grew, true);
		expect(same).toBe(grew);
		expect(view.length).toBe(4);
		expect(Array.from(view)).toEqual([0, 22, 44, 66]);
	});

	it('view length is rowCount + 1; view[rowCount] is the total height', () => {
		const heights = [10, 20, 30];
		const { view } = buildOffsets(3, (i) => heights[i], new Float64Array(0), false);
		expect(view.length).toBe(4);
		expect(view[3]).toBe(60); // 10 + 20 + 30
	});

	it('returns a fresh subarray view each call so reactive deps see the change', () => {
		const buf = new Float64Array(20);
		const a = buildOffsets(5, () => 22, buf, true);
		const b = buildOffsets(5, () => 22, a.buf, true);
		expect(a.view).not.toBe(b.view);
	});
});

describe('indexAtOffset', () => {
	const offsets = [0, 22, 44, 66, 88, 110];

	it('returns 0 at or before the first row', () => {
		expect(indexAtOffset(offsets, 5, 0)).toBe(0);
		expect(indexAtOffset(offsets, 5, 21)).toBe(0);
	});

	it('returns the row whose top is at exactly y', () => {
		expect(indexAtOffset(offsets, 5, 22)).toBe(1);
		expect(indexAtOffset(offsets, 5, 88)).toBe(4);
	});

	it('returns the row containing y when y is in the middle', () => {
		expect(indexAtOffset(offsets, 5, 23)).toBe(1);
		expect(indexAtOffset(offsets, 5, 43)).toBe(1);
		expect(indexAtOffset(offsets, 5, 65)).toBe(2);
	});

	it('clamps at the last row when y is past the total height', () => {
		expect(indexAtOffset(offsets, 5, 999)).toBe(5);
	});

	it('handles variable heights via offsets prefix sum', () => {
		const variable = [0, 10, 30, 60];
		expect(indexAtOffset(variable, 3, 5)).toBe(0);
		expect(indexAtOffset(variable, 3, 11)).toBe(1);
		expect(indexAtOffset(variable, 3, 31)).toBe(2);
	});
});

describe('visibleWindow', () => {
	const offsets = [0, 22, 44, 66, 88, 110, 132, 154, 176, 198, 220];

	it('scrolled to top: window includes rows around the start (overscan above clamped to 0)', () => {
		const { start, end } = visibleWindow(offsets, 10, 0, 88, 2);
		expect(start).toBe(0);
		expect(end).toBe(6);
	});

	it('scrolled into the middle: includes overscan on both sides', () => {
		const { start, end } = visibleWindow(offsets, 10, 66, 44, 2);
		expect(start).toBe(1); // row 3 − overscan 2
		expect(end).toBe(7); // last covered row 4 + overscan 2, plus +1 for the bottom-walk landing on row 5
	});

	it('scrolled to bottom: end clamped to row count', () => {
		const { start, end } = visibleWindow(offsets, 10, 198, 22, 2);
		expect(end).toBe(10);
		expect(start).toBe(7);
	});

	it('rowCount=0 returns a zero window', () => {
		const { start, end } = visibleWindow([0], 0, 0, 100, 2);
		expect(start).toBe(0);
		expect(end).toBe(0);
	});

	it('overscan of 0 returns the strict viewport rows', () => {
		const { start, end } = visibleWindow(offsets, 10, 22, 44, 0);
		expect(start).toBe(1);
		expect(end).toBe(3);
	});

	it('respects variable row heights', () => {
		const off = [0, 50, 60, 70, 120, 130];
		const { start, end } = visibleWindow(off, 5, 55, 20, 0);
		expect(start).toBe(1);
		expect(end).toBe(4);
	});
});

describe('constants', () => {
	it('DEFAULT_ROW_H is exported for callers that need it', () => {
		expect(DEFAULT_ROW_H).toBe(22);
	});
});
