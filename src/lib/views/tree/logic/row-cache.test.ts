import { describe, expect, it } from 'vitest';
import { PathIndex, RowHeights } from './row-cache';
import type { Row } from './model';

const content = (path: (string | number)[]) =>
	({ variant: 'content', path, depth: path.length }) as unknown as Row;

describe('PathIndex', () => {
	it('finds a row by path and rebuilds only after it is invalidated', () => {
		const index = new PathIndex();
		const rows = [content([]), content(['a']), content(['b'])];
		expect(index.find(rows, ['b'])).toBe(2);
		rows.splice(1, 1);
		expect(index.find(rows, ['b'])).toBe(2);
		index.invalidate();
		expect(index.find(rows, ['b'])).toBe(1);
		expect(index.find(rows, ['gone'])).toBe(-1);
	});
});

describe('RowHeights', () => {
	it('keeps only rows taller than the base height and reports each change', () => {
		const heights = new RowHeights(22);
		expect(heights.record('a', 22)).toBe(false);
		expect(heights.record('a', 60)).toBe(true);
		expect(heights.record('a', 60)).toBe(false);
		expect(heights.get('a')).toBe(60);
		expect(heights.get('b')).toBe(22);
		expect(heights.record('a', 22)).toBe(true);
		expect(heights.get('a')).toBe(22);
	});

	it('reports whether clearing removed anything', () => {
		const heights = new RowHeights(22);
		expect(heights.clear()).toBe(false);
		heights.record('a', 80);
		expect(heights.clear()).toBe(true);
	});
});
