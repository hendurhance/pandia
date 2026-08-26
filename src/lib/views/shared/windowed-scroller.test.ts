// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { flushSync } from 'svelte';
import { WindowedScroller } from './windowed-scroller.svelte';
import { inRoot, reactiveBox } from './test-runes.svelte';

beforeAll(() => {
	// jsdom has no ResizeObserver; the scroller only needs observe/disconnect.
	class RO {
		observe() {}
		disconnect() {}
		unobserve() {}
	}
	Object.assign(globalThis, { ResizeObserver: RO });
});

function scrollerEl(height = 300): HTMLElement {
	const el = document.createElement('div');
	Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
	Object.defineProperty(el, 'clientWidth', { value: 500, configurable: true });
	el.scrollTo = (opts?: ScrollToOptions | number) => {
		if (typeof opts === 'object' && opts?.top !== undefined) el.scrollTop = opts.top;
	};
	return el;
}

describe('WindowedScroller — fixed heights', () => {
	it('computes window, total height, and offsets without an offsets array', () => {
		const rowCount = reactiveBox(1000);
		const { result: s, destroy } = inRoot(
			() => new WindowedScroller({ rowCount: () => rowCount.value, rowHeight: 20, overscan: 2 }),
		);
		try {
			const el = scrollerEl(300);
			s.attach(el);
			flushSync();
			expect(s.viewportHeight).toBe(300);
			expect(s.totalHeight).toBe(20_000);
			expect(s.offsetAt(7)).toBe(140);

			el.scrollTop = 400;
			el.dispatchEvent(new Event('scroll'));
			flushSync();
			expect(s.scrollTop).toBe(400);
			expect(s.window.start).toBe(18); // floor(400/20) - overscan
			expect(s.window.end).toBe(Math.ceil(700 / 20) + 2);
		} finally {
			destroy();
		}
	});

	it('anchors the viewport when rows are inserted above it (index keys shift)', () => {
		const keys = reactiveBox(Array.from({ length: 100 }, (_, i) => `k${i}`));
		const { result: s, destroy } = inRoot(
			() =>
				new WindowedScroller({
					rowCount: () => keys.value.length,
					rowHeight: 20,
					keyAt: (i) => keys.value[i] ?? '',
				}),
		);
		try {
			const el = scrollerEl(300);
			s.attach(el);
			el.scrollTop = 400; // row k20 at the top
			el.dispatchEvent(new Event('scroll'));
			flushSync();

			// Insert 10 rows before k20 — the anchored row moves down 200px.
			keys.value = [
				...keys.value.slice(0, 20),
				...Array.from({ length: 10 }, (_, i) => `new${i}`),
				...keys.value.slice(20),
			];
			flushSync();
			expect(s.scrollTop).toBe(600);
			expect(el.scrollTop).toBe(600);
		} finally {
			destroy();
		}
	});

	it('starts fresh content at the top instead of restoring a stale anchor', () => {
		const count = reactiveBox(0);
		const { result: s, destroy } = inRoot(
			() => new WindowedScroller({ rowCount: () => count.value, rowHeight: 20 }),
		);
		try {
			const el = scrollerEl(300);
			s.attach(el);
			el.scrollTop = 100;
			el.dispatchEvent(new Event('scroll'));
			flushSync();
			count.value = 50;
			flushSync();
			expect(s.scrollTop).toBe(0);
			expect(el.scrollTop).toBe(0);
		} finally {
			destroy();
		}
	});
});

describe('WindowedScroller — variable heights', () => {
	it('uses heightAt for offsets and invalidates via heightsVersion', () => {
		const heights = new Map<number, number>([[1, 100]]);
		const version = reactiveBox(0);
		const { result: s, destroy } = inRoot(
			() =>
				new WindowedScroller({
					rowCount: () => 5,
					rowHeight: 20,
					heightAt: (i) => heights.get(i) ?? 20,
					heightsVersion: () => version.value,
				}),
		);
		try {
			expect(s.totalHeight).toBe(20 + 100 + 20 * 3);
			expect(s.offsetAt(2)).toBe(120);
			heights.set(1, 40);
			version.value += 1;
			flushSync();
			expect(s.totalHeight).toBe(20 + 40 + 20 * 3);
			expect(s.offsetAt(2)).toBe(60);
		} finally {
			destroy();
		}
	});

	it('reports width changes so views can invalidate measurements, but not the first measure', () => {
		const changes: [number, number][] = [];
		const { result: s, destroy } = inRoot(
			() =>
				new WindowedScroller({
					rowCount: () => 10,
					rowHeight: 20,
					onWidthChange: (w, prev) => changes.push([w, prev]),
				}),
		);
		try {
			const el = scrollerEl(300);
			const attached = s.attach(el);
			expect(s.viewportWidth).toBe(500);
			expect(changes).toEqual([]); // first measurement is not a change
			attached.destroy();
		} finally {
			destroy();
		}
	});
});
