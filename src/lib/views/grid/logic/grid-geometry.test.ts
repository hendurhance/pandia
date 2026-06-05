import { describe, it, expect } from 'vitest';
import {
	kindIdealCh,
	idealCh,
	autoFitWidthPx,
	computeColumnLayout,
	columnWindow,
	rowWindow,
	PX_PER_CH,
	type ColumnLayout,
} from './grid-geometry';
import type { Column } from '$lib/ipc/types';

function col(over: Partial<Column>): Column {
	return {
		key: 'k',
		kinds: ['string'],
		dominantKind: 'string',
		presence: 1,
		nullable: false,
		...over,
	};
}

describe('kindIdealCh', () => {
	it('maps each kind to its ideal char width', () => {
		expect(kindIdealCh('number')).toBe(12);
		expect(kindIdealCh('bool')).toBe(5);
		expect(kindIdealCh('null')).toBe(4);
		expect(kindIdealCh('string')).toBe(24);
		expect(kindIdealCh('object')).toBe(14);
		expect(kindIdealCh('array')).toBe(14);
	});
});

describe('idealCh', () => {
	it('takes the max of label/kind widths plus padding', () => {
		expect(idealCh(col({ key: 'x', dominantKind: 'number' }))).toBe(14);
	});

	it('clamps very long keys to the max', () => {
		expect(idealCh(col({ key: 'x'.repeat(60), dominantKind: 'string' }))).toBe(48);
	});
});

describe('autoFitWidthPx', () => {
	const MIN = 40;
	const MAX = 1200;

	it('fits the longest cell text, not a per-kind guess', () => {
		const long = 'x'.repeat(80); // far wider than idealCh's 48-char cap
		const w = autoFitWidthPx(col({ key: 'k' }), [long, 'short'], MIN, MAX);
		expect(w).toBe(Math.round((80 + 2) * PX_PER_CH));
		expect(w).toBeGreaterThan(idealCh(col({ key: 'k' })) * PX_PER_CH);
	});

	it('falls back to the header when cells are narrower (key + affordances)', () => {
		const w = autoFitWidthPx(col({ key: 'name' }), ['ab', 'cd'], MIN, MAX);
		expect(w).toBe(Math.round((9 + 2) * PX_PER_CH));
	});

	it('widens the header for mixed-type and nullable marks', () => {
		const plain = autoFitWidthPx(col({ key: 'k' }), [], MIN, MAX);
		const marked = autoFitWidthPx(
			col({ key: 'k', kinds: ['string', 'number'], nullable: true }),
			[],
			MIN,
			MAX,
		);
		expect(marked).toBeGreaterThan(plain);
	});

	it('clamps to [minPx, maxPx]', () => {
		expect(autoFitWidthPx(col({ key: 'a' }), [], MIN, MAX)).toBeGreaterThanOrEqual(MIN);
		expect(autoFitWidthPx(col({ key: 'k' }), ['y'.repeat(5000)], MIN, MAX)).toBe(MAX);
	});
});

describe('computeColumnLayout', () => {
	it('builds prefix-sum offsets and total from ideal widths', () => {
		const cols = [
			col({ key: 'a', dominantKind: 'number' }),
			col({ key: 'b', dominantKind: 'bool' }),
		];
		const layout = computeColumnLayout(cols, new Map());
		const wA = idealCh(cols[0]) * PX_PER_CH;
		const wB = idealCh(cols[1]) * PX_PER_CH;
		expect(layout.widths).toEqual([wA, wB]);
		expect(layout.offsets).toEqual([0, wA]);
		expect(layout.total).toBe(wA + wB);
	});

	it('honors per-column width overrides', () => {
		const cols = [col({ key: 'a' }), col({ key: 'b' })];
		const layout = computeColumnLayout(cols, new Map([['a', 200]]));
		expect(layout.widths[0]).toBe(200);
		expect(layout.offsets).toEqual([0, 200]);
	});
});

describe('columnWindow', () => {
	const layout: ColumnLayout = { widths: [100, 100, 100], offsets: [0, 100, 200], total: 300 };

	it('returns the columns intersecting the viewport (no overscan)', () => {
		expect(columnWindow(layout, 0, 150, 0)).toEqual({ start: 0, end: 2 });
	});

	it('pads by overscan and clamps to bounds', () => {
		expect(columnWindow(layout, 0, 150, 1)).toEqual({ start: 0, end: 3 });
	});

	it('is empty for no columns', () => {
		expect(columnWindow({ widths: [], offsets: [], total: 0 }, 0, 500, 4)).toEqual({
			start: 0,
			end: 0,
		});
	});
});

describe('rowWindow', () => {
	it('returns the rows intersecting the viewport (no overscan)', () => {
		expect(rowWindow(0, 100, 24, 1000, 0)).toEqual({ start: 0, end: 5 });
	});

	it('pads by overscan and clamps start at 0', () => {
		expect(rowWindow(240, 100, 24, 1000, 8)).toEqual({ start: 2, end: 23 });
	});

	it('clamps end to rowCount', () => {
		expect(rowWindow(0, 1000, 24, 3, 0)).toEqual({ start: 0, end: 3 });
	});
});
