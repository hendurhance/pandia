// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from '@testing-library/svelte';
import { insertChildrenWithClose, rootRow, type ContentRow, type Row } from '../logic/model';
import TreeView from './TreeView.svelte';

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const VIEWPORT = 600;
// jsdom has no layout; give every element the tree's viewport height.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
	configurable: true,
	get: () => VIEWPORT,
});

// WebKit and Blink store layout sizes as an int32 count of 1/64 px (LayoutUnit),
// so a taller element is clamped and the rows past it can't be scrolled to.
const LAYOUT_MAX_PX = Math.floor(0x7fffffff / 64);

function expandedArray(count: number): Row[] {
	const rows: Row[] = [{ ...rootRow('array', count), expanded: true }];
	const loaded = Array.from(
		{ length: 200 },
		(_, i): ContentRow => ({
			variant: 'content',
			path: [i],
			depth: 1,
			key: i,
			kind: 'number',
			preview: String(i),
			childCount: null,
			expanded: false,
		}),
	);
	insertChildrenWithClose(rows, 0, loaded, count);
	return rows;
}

function translateY(el: HTMLElement): number {
	return parseFloat(/translate3d\(0, ([-\d.]+)px/.exec(el.style.transform)![1]!);
}

describe('TreeView scrolling', () => {
	it.each([1_000, 2_000_000])(
		'reaches the last of %i array items within the layout limit',
		(count) => {
			const onMaterializeGap = vi.fn();
			const { container } = render(TreeView, {
				props: {
					rows: expandedArray(count),
					selectedIndex: -1,
					onToggle: () => {},
					onSelect: () => {},
					onVisibleRange: () => {},
					onRowMenu: () => {},
					scrollRequest: null,
					editing: null,
					onEditInput: () => {},
					onEditCommit: () => {},
					onEditCancel: () => {},
					onMaterializeGap,
				},
			});
			const scroller = container.querySelector<HTMLElement>('.scroller')!;
			const spacer = container.querySelector<HTMLElement>('.spacer')!;
			const height = parseFloat(spacer.style.height);
			expect(height).toBeLessThanOrEqual(LAYOUT_MAX_PX);

			scroller.scrollTop = height - VIEWPORT;
			scroller.dispatchEvent(new Event('scroll'));
			flushSync();

			expect(onMaterializeGap.mock.lastCall?.[2]).toBe(count);
			const close = container.querySelector<HTMLElement>('.r.close')!;
			expect(translateY(close) + 22).toBeCloseTo(height);
		},
	);
});
