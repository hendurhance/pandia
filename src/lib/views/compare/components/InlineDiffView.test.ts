// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import InlineDiffView from './InlineDiffView.svelte';

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docDiffLines: vi.fn(),
		docGetLines: vi.fn(async (_h: unknown, start: number, end: number) =>
			Array.from({ length: end - start }, () => '1,'),
		),
		cancelJob: vi.fn(async () => true),
	},
}));

const VIEWPORT = 600;
// jsdom has no layout; give every element the view's viewport height.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
	configurable: true,
	get: () => VIEWPORT,
});

// WebKit and Blink store layout sizes as an int32 count of 1/64 px (LayoutUnit),
// so a taller element is clamped and the rows past it can't be scrolled to.
const LAYOUT_MAX_PX = Math.floor(0x7fffffff / 64);

describe('InlineDiffView scrolling', () => {
	it.each([100, 2_000_000])(
		'reaches the last of %i diff lines within the layout limit',
		async (lines) => {
			vi.mocked(ipc.docDiffLines).mockResolvedValue({
				hunks: [{ leftStart: 0, leftLen: 0, rightStart: 0, rightLen: lines }],
				leftLines: 0,
				rightLines: lines,
			});
			const { container } = render(InlineDiffView, {
				props: {
					leftHandle: 'L' as never,
					rightHandle: 'R' as never,
					leftVersion: 1,
					rightVersion: 1,
					activeHunk: -1,
				},
			});
			const spacer = await vi.waitFor(() => {
				const el = container.querySelector<HTMLElement>('.spacer');
				expect(el).not.toBeNull();
				return el!;
			});
			const height = parseFloat(spacer.style.height);
			expect(height).toBeLessThanOrEqual(LAYOUT_MAX_PX);

			const scroller = container.querySelector<HTMLElement>('.inline-scroller')!;
			scroller.scrollTop = height - VIEWPORT;
			scroller.dispatchEvent(new Event('scroll'));
			flushSync();

			const last = [...container.querySelectorAll<HTMLElement>('.row')].at(-1)!;
			expect(last.dataset.row).toBe(String(lines - 1));
			expect(parseFloat(last.style.top) + 22).toBeCloseTo(height);
		},
	);
});
