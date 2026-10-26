// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import GraphCanvas, { type GraphCanvasApi } from './GraphCanvas.svelte';
import type { CardRow } from '../logic/layout';
import { screenToWorld } from '../logic/viewport';

globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
HTMLCanvasElement.prototype.getBoundingClientRect = () => new DOMRect(200, 100, 800, 600);
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => 600 });

describe('GraphCanvas — zoom buttons', () => {
	it('keeps the point at the center of the canvas fixed', async () => {
		let api: GraphCanvasApi | null = null;
		render(GraphCanvas, {
			props: {
				layout: { cards: [], edges: [], width: 0, height: 0 },
				onPickCard: vi.fn(),
				onPortToggle: vi.fn(),
				onShowMore: vi.fn(),
				onReady: (a: GraphCanvasApi | null) => (api = a),
			},
		});
		await vi.waitFor(() => expect(api).not.toBeNull());

		const center = screenToWorld(api!.viewport(), 400, 300);
		api!.zoomBy(1.25);
		const after = screenToWorld(api!.viewport(), 400, 300);

		expect(after.x).toBeCloseTo(center.x);
		expect(after.y).toBeCloseTo(center.y);
	});
});

describe('GraphCanvas — the "… N more" card', () => {
	it('pages in more items instead of jumping to the path', async () => {
		const more = { row: {} as CardRow, total: 500 };
		const card = { id: 'm', path: ['items', 100], title: '… 400 more', kind: 'array' as const };
		const layout = {
			cards: [{ ...card, rows: [], hue: 0, more, x: 0, y: 0, w: 140, h: 30 }],
			edges: [],
			width: 140,
			height: 30,
		};
		const onPickCard = vi.fn();
		const onShowMore = vi.fn();
		const { container } = render(GraphCanvas, {
			props: { layout, onPickCard, onPortToggle: vi.fn(), onShowMore },
		});
		const canvas = container.querySelector('canvas')!;
		canvas.setPointerCapture = () => {};

		const at = { button: 0, pointerId: 1, clientX: 200 + 40 + 10, clientY: 100 + 40 + 10 };
		await fireEvent.pointerDown(canvas, at);
		await fireEvent.pointerUp(canvas, at);

		expect(onShowMore).toHaveBeenCalledWith(more);
		expect(onPickCard).not.toHaveBeenCalled();
	});
});
