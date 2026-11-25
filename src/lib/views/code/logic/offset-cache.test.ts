import { describe, expect, it } from 'vitest';
import { OffsetCache } from './offset-cache';

describe('OffsetCache', () => {
	it('asks only for paths it has neither cached nor started loading, once each', async () => {
		const cache = new OffsetCache();
		await cache.load(
			[['a']],
			async () => [{ start: 1, end: 4 }],
			() => true,
		);
		let finish!: (r: { start: number; end: number }[]) => void;
		const pending = cache.load(
			[['b']],
			() => new Promise((r) => (finish = r)),
			() => true,
		);
		expect(cache.missing([['a'], ['b'], ['c'], ['c']])).toEqual([['c']]);
		finish([{ start: 5, end: 9 }]);
		await pending;
		expect(cache.get(['b'])).toEqual({ start: 5, end: 9 });
	});

	it('drops a load that finishes after the cache was cleared', async () => {
		const cache = new OffsetCache();
		let finish!: (r: { start: number; end: number }[]) => void;
		const pending = cache.load(
			[['a']],
			() => new Promise((r) => (finish = r)),
			() => true,
		);
		cache.clear();
		finish([{ start: 1, end: 2 }]);
		expect(await pending).toBe(false);
		expect(cache.get(['a'])).toBeUndefined();
		expect(cache.missing([['a']])).toEqual([['a']]);
	});

	it('drops a load the caller no longer wants', async () => {
		const cache = new OffsetCache();
		expect(
			await cache.load(
				[['a']],
				async () => [{ start: 1, end: 2 }],
				() => false,
			),
		).toBe(false);
		expect(cache.get(['a'])).toBeUndefined();
	});
});
