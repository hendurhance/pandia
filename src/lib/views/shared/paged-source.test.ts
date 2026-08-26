import { describe, it, expect, vi } from 'vitest';
import { PagedSource, type PagedFetchResult } from './paged-source.svelte';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function items(start: number, end: number): string[] {
	return Array.from({ length: end - start }, (_, k) => `row-${start + k}`);
}

describe('PagedSource', () => {
	it('fetches the pages intersecting a range and serves items by index', async () => {
		const calls: [number, number][] = [];
		const src = new PagedSource<string>({
			pageSize: 10,
			fetch: async (start, end) => {
				calls.push([start, end]);
				return { items: items(start, end) };
			},
			onError: () => {},
		});
		await src.ensureRange(5, 25);
		expect(calls).toEqual([
			[0, 10],
			[10, 20],
			[20, 30],
		]);
		expect(src.get(7)).toBe('row-7');
		expect(src.get(24)).toBe('row-24');
		expect(src.get(30)).toBeUndefined();
	});

	it('never double-fetches: concurrent requests for one page share the flight', async () => {
		const d = deferred<PagedFetchResult<string>>();
		const fetch = vi.fn(() => d.promise);
		const src = new PagedSource<string>({ pageSize: 10, fetch, onError: () => {} });
		const a = src.ensureRange(0, 10);
		const b = src.ensureRange(3, 8);
		expect(fetch).toHaveBeenCalledTimes(1);
		d.resolve({ items: items(0, 10) });
		await Promise.all([a, b]);
		expect(src.get(3)).toBe('row-3');
		await src.ensureRange(0, 10);
		expect(fetch).toHaveBeenCalledTimes(1); // loaded page is never refetched
	});

	it('discards a response that resolves after reset — the stale write never lands', async () => {
		const d = deferred<PagedFetchResult<string>>();
		const src = new PagedSource<string>({
			pageSize: 10,
			fetch: () => d.promise,
			onError: () => {},
		});
		const flight = src.ensureRange(0, 10);
		src.reset();
		d.resolve({ items: items(0, 10), total: 999 });
		await flight;
		expect(src.pages.size).toBe(0);
		expect(src.total).toBeNull();
	});

	it('suppresses an error that lands after reset, reports one that lands before', async () => {
		const onError = vi.fn();
		const early = deferred<PagedFetchResult<string>>();
		const src = new PagedSource<string>({ pageSize: 10, fetch: () => early.promise, onError });
		const flight = src.ensureRange(0, 10);
		early.reject(new Error('boom'));
		await flight;
		expect(onError).toHaveBeenCalledTimes(1);

		const late = deferred<PagedFetchResult<string>>();
		const src2 = new PagedSource<string>({ pageSize: 10, fetch: () => late.promise, onError });
		const flight2 = src2.ensureRange(0, 10);
		src2.reset();
		late.reject(new Error('stale boom'));
		await flight2;
		expect(onError).toHaveBeenCalledTimes(1); // unchanged
	});

	it('captures a reported total and calls onReset when resetting', async () => {
		const onReset = vi.fn();
		const src = new PagedSource<string>({
			pageSize: 10,
			fetch: async (start, end) => ({ items: items(start, end), total: 123 }),
			onError: () => {},
			onReset,
		});
		await src.ensureRange(0, 5);
		expect(src.total).toBe(123);
		src.reset();
		expect(onReset).toHaveBeenCalledTimes(1);
		expect(src.total).toBeNull();
		expect(src.pages.size).toBe(0);
	});

	it('ensureVisible debounces: only the last range within the window fetches', async () => {
		vi.useFakeTimers();
		try {
			const calls: [number, number][] = [];
			const src = new PagedSource<string>({
				pageSize: 10,
				fetch: async (start, end) => {
					calls.push([start, end]);
					return { items: items(start, end) };
				},
				onError: () => {},
				debounceMs: 80,
			});
			src.ensureVisible(0, 10);
			src.ensureVisible(40, 50);
			src.ensureVisible(90, 100);
			expect(calls).toEqual([]);
			await vi.advanceTimersByTimeAsync(80);
			expect(calls).toEqual([[90, 100]]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('tracks the fetching flag across overlapping flights', async () => {
		const d1 = deferred<PagedFetchResult<string>>();
		const d2 = deferred<PagedFetchResult<string>>();
		const pending = [d1, d2];
		const src = new PagedSource<string>({
			pageSize: 10,
			fetch: () => {
				const d = pending.shift();
				if (!d) throw new Error('unexpected extra fetch');
				return d.promise;
			},
			onError: () => {},
		});
		const a = src.ensureRange(0, 10);
		const b = src.ensureRange(10, 20);
		expect(src.fetching).toBe(true);
		d1.resolve({ items: items(0, 10) });
		await a;
		expect(src.fetching).toBe(true);
		d2.resolve({ items: items(10, 20) });
		await b;
		expect(src.fetching).toBe(false);
	});
});
