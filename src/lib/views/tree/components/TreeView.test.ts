// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from '@testing-library/svelte';
import {
	insertChildrenWithClose,
	rootRow,
	type CloseRow,
	type ContentRow,
	type Row,
	type VirtualGapRow,
} from '../logic/model';
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

function item(i: number): ContentRow {
	return {
		variant: 'content',
		path: [i],
		depth: 1,
		key: i,
		kind: 'number',
		preview: String(i),
		childCount: null,
		expanded: false,
	};
}

describe('TreeView drag to reorder', () => {
	const ROW_H = 22;
	const close: CloseRow = { variant: 'close', depth: 0, bracket: ']', parentPath: [] };
	const gapAbove: VirtualGapRow = {
		variant: 'vgap',
		parentPath: [],
		depth: 1,
		fromIndex: 0,
		toIndex: 5,
	};
	const root = (count: number): ContentRow => ({ ...rootRow('array', count), expanded: true });
	const loadedAbove = (): Row[] => [root(8), ...[0, 1, 2, 3, 4, 5, 6, 7].map(item), close];

	function startDragOnItem5() {
		const onReorder = vi.fn();
		const view = render(TreeView, {
			props: {
				rows: [root(8), gapAbove, item(5), item(6), item(7), close],
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
				onReorder,
			},
		});
		const scroller = view.container.querySelector<HTMLElement>('.scroller')!;
		scroller.setPointerCapture = () => {};
		const pointer = (target: Element, type: string, clientY: number) => {
			target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientY }));
			flushSync();
		};
		const grip = view.container.querySelector('.r[data-ri="2"] .grip')!;
		pointer(grip, 'pointerdown', 6 * ROW_H + 8);
		pointer(scroller, 'pointermove', 5 * ROW_H);
		return { ...view, scroller, pointer, onReorder };
	}

	it('reorders the dragged row after rows load above it mid-drag', async () => {
		const { rerender, scroller, pointer, onReorder } = startDragOnItem5();
		await rerender({ rows: loadedAbove() });
		pointer(scroller, 'pointermove', ROW_H);
		pointer(scroller, 'pointerup', ROW_H);
		expect(onReorder.mock.calls).toEqual([[item(5), 0]]);
	});

	it('keeps the dragging highlight on the dragged row after rows load above it', async () => {
		const { container, rerender } = startDragOnItem5();
		await rerender({ rows: loadedAbove() });
		const highlighted = [...container.querySelectorAll<HTMLElement>('.r.dragging')];
		expect(highlighted.map((el) => el.dataset.ri)).toEqual(['6']);
	});

	it('cancels the drag without reordering when the dragged row leaves the rows', async () => {
		const { rerender, scroller, pointer, onReorder } = startDragOnItem5();
		await rerender({ rows: [root(3), item(0), item(1), item(2), close] });
		pointer(scroller, 'pointermove', ROW_H);
		expect(scroller.classList.contains('dragging')).toBe(false);
		pointer(scroller, 'pointerup', ROW_H);
		expect(onReorder).not.toHaveBeenCalled();
	});
});
