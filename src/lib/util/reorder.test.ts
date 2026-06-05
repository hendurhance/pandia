import { describe, it, expect } from 'vitest';
import { reorderDestination } from './reorder';

function dropBefore<T>(arr: T[], from: number, g: number): T[] {
	const rest = arr.filter((_, i) => i !== from);
	const insertAt = from < g ? g - 1 : g;
	rest.splice(insertAt, 0, arr[from]);
	return rest;
}

describe('reorderDestination', () => {
	it('is a no-op when dropped into its own slot (before or after itself)', () => {
		expect(reorderDestination(0, 0)).toBeNull(); // before itself
		expect(reorderDestination(0, 1)).toBeNull(); // right after itself
		expect(reorderDestination(3, 3)).toBeNull();
		expect(reorderDestination(3, 4)).toBeNull();
	});

	it('moves forward (gap past the item shifts down by one after removal)', () => {
		expect(reorderDestination(0, 2)).toBe(1);
		expect(reorderDestination(2, 5)).toBe(4);
		expect(reorderDestination(0, 4)).toBe(3); // to the end of a 4-item list
	});

	it('moves backward (gap before the item is unaffected by removal)', () => {
		expect(reorderDestination(3, 0)).toBe(0);
		expect(reorderDestination(3, 1)).toBe(1);
		expect(reorderDestination(2, 0)).toBe(0);
	});

	it('matches a remove-then-insert reference for every (from, gap) pair', () => {
		const base = ['a', 'b', 'c', 'd', 'e'];
		const n = base.length;
		for (let from = 0; from < n; from++) {
			for (let gap = 0; gap <= n; gap++) {
				const dest = reorderDestination(from, gap);
				const expected = dropBefore(base, from, gap);
				if (dest === null) {
					expect(expected).toEqual(base);
				} else {
					const got = base.filter((_, i) => i !== from);
					got.splice(dest, 0, base[from]);
					expect(got).toEqual(expected);
				}
			}
		}
	});
});
