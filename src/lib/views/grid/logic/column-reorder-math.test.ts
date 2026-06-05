import { describe, expect, it } from 'vitest';
import { contentXFromClient, gapForX } from './column-reorder-math';

describe('gapForX', () => {
	const offsets = [0, 100, 200];
	const widths = [100, 100, 100];

	it('returns 0 before the first column midpoint', () => {
		expect(gapForX(0, offsets, widths)).toBe(0);
		expect(gapForX(49, offsets, widths)).toBe(0);
	});

	it('returns 1 once the pointer passes the first column midpoint', () => {
		expect(gapForX(51, offsets, widths)).toBe(1);
		expect(gapForX(99, offsets, widths)).toBe(1);
	});

	it('returns 2 once past the second column midpoint', () => {
		expect(gapForX(151, offsets, widths)).toBe(2);
		expect(gapForX(199, offsets, widths)).toBe(2);
	});

	it('returns the column count when past the last midpoint', () => {
		expect(gapForX(251, offsets, widths)).toBe(3);
		expect(gapForX(9999, offsets, widths)).toBe(3);
	});

	it('handles a single column', () => {
		expect(gapForX(0, [0], [80])).toBe(0);
		expect(gapForX(40, [0], [80])).toBe(0); // exactly at midpoint → still 0
		expect(gapForX(41, [0], [80])).toBe(1);
	});

	it('handles empty arrays', () => {
		expect(gapForX(0, [], [])).toBe(0);
		expect(gapForX(9999, [], [])).toBe(0);
	});

	it('handles uneven column widths', () => {
		const off = [0, 20];
		const w = [20, 200];
		expect(gapForX(10, off, w)).toBe(0); // before midpoint of col 0 (x=10)
		expect(gapForX(11, off, w)).toBe(1); // past col 0 midpoint
		expect(gapForX(120, off, w)).toBe(1); // before midpoint of col 1 (x=120)
		expect(gapForX(121, off, w)).toBe(2); // past col 1 midpoint
	});
});

describe('contentXFromClient', () => {
	it('subtracts the header rect left and adds the scroll offset', () => {
		expect(contentXFromClient(400, 300, 150)).toBe(250);
	});

	it('handles zero scroll', () => {
		expect(contentXFromClient(50, 0, 0)).toBe(50);
	});

	it('returns the offset itself when the pointer is at the rect left', () => {
		expect(contentXFromClient(100, 100, 0)).toBe(0);
		expect(contentXFromClient(100, 100, 75)).toBe(75);
	});
});
