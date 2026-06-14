import { describe, it, expect } from 'vitest';
import { findIndexPaged } from './paging';

function pagedSource<T>(items: T[]) {
	const calls: Array<[number, number]> = [];
	const fetch = async (start: number, end: number): Promise<T[]> => {
		calls.push([start, end]);
		return items.slice(start, end);
	};
	return { fetch, calls };
}

describe('findIndexPaged', () => {
	it('finds an item in the first chunk', async () => {
		const { fetch } = pagedSource(['a', 'b', 'c']);
		expect(await findIndexPaged(fetch, (x) => x === 'b', 200, 2000)).toBe(1);
	});

	it('finds an item in a later chunk and returns its absolute index', async () => {
		const items = Array.from({ length: 250 }, (_, i) => i);
		const { fetch, calls } = pagedSource(items);
		expect(await findIndexPaged(fetch, (x) => x === 205, 5, 10_000)).toBe(205);
		expect(calls[0]).toEqual([0, 5]); // paged in steps of `chunk` from 0
	});

	it('returns null when the item is absent and a short final page ends paging', async () => {
		const { fetch } = pagedSource([1, 2, 3]);
		expect(await findIndexPaged(fetch, (x) => x === 9, 5, 100)).toBeNull();
	});

	it('stops at the maxStart cap when every page is full (never-ending source)', async () => {
		const starts: number[] = [];
		const fetch = async (start: number, end: number): Promise<number[]> => {
			starts.push(start);
			return Array.from({ length: end - start }, () => 0); // always a full page, never a match
		};
		expect(await findIndexPaged(fetch, (x) => x === 1, 200, 2000)).toBeNull();
		expect(Math.max(...starts)).toBe(2000);
	});

	it('returns null on an empty source', async () => {
		const { fetch } = pagedSource<number>([]);
		expect(await findIndexPaged(fetch, () => true, 5, 100)).toBeNull();
	});
});
