import { describe, expect, it } from 'vitest';
import {
	centerOn,
	clampScale,
	fitToContent,
	hitTest,
	MAX_SCALE,
	MIN_SCALE,
	pan,
	rectsOverlap,
	screenToWorld,
	viewportWorldRect,
	zoomAt,
	type ViewportState,
} from './viewport';
import { HEADER_H, ROW_H, type LayoutResult, type PositionedCard } from './layout';
import type { NodeKind } from '$lib/ipc/types';

const idScale = (): ViewportState => ({ tx: 0, ty: 0, scale: 1 });

function card(id: string, x: number, y: number, w = 200, h = 100, rows = 0): PositionedCard {
	const cardRows = Array.from({ length: rows }, (_, i) => ({
		key: `k${i}`,
		value: 'v',
		valueKind: 'string' as NodeKind,
		colorHex: null,
		container: false,
		expandable: false,
		childPath: [],
		children: [],
	}));
	return {
		id,
		path: [],
		title: id,
		kind: 'object' as NodeKind,
		rows: cardRows,
		hue: 0,
		x,
		y,
		w,
		h,
	};
}

describe('clampScale', () => {
	it('clamps to [MIN_SCALE, MAX_SCALE]', () => {
		expect(clampScale(0.001)).toBe(MIN_SCALE);
		expect(clampScale(99)).toBe(MAX_SCALE);
		expect(clampScale(1.5)).toBe(1.5);
	});
});

describe('pan', () => {
	it('translates by the given screen delta', () => {
		const v = pan(idScale(), 50, -20);
		expect(v).toEqual({ tx: 50, ty: -20, scale: 1 });
	});
});

describe('zoomAt', () => {
	it('preserves the world point under the anchor (the natural feel)', () => {
		const v: ViewportState = { tx: 100, ty: 50, scale: 1 };
		const before = screenToWorld(v, 200, 150);
		const after = zoomAt(v, 200, 150, 2);
		const w = screenToWorld(after, 200, 150);
		expect(w.x).toBeCloseTo(before.x, 6);
		expect(w.y).toBeCloseTo(before.y, 6);
		expect(after.scale).toBe(2);
	});

	it('clamps to MAX_SCALE without moving the anchor', () => {
		const v: ViewportState = { tx: 0, ty: 0, scale: MAX_SCALE };
		const after = zoomAt(v, 100, 100, 10);
		expect(after.scale).toBe(MAX_SCALE);
		expect(after.tx).toBe(0);
		expect(after.ty).toBe(0);
	});

	it('is a no-op at the clamp boundary', () => {
		const v: ViewportState = { tx: 7, ty: -3, scale: MIN_SCALE };
		const after = zoomAt(v, 50, 50, 0.0001);
		expect(after).toBe(v); // same reference — early exit
	});
});

describe('centerOn', () => {
	it('puts the given world point at screen center, preserving scale', () => {
		const v: ViewportState = { tx: 12, ty: -7, scale: 1.5 };
		const out = centerOn(v, 100, 50, 800, 400);
		expect(out.scale).toBe(1.5);
		const c = screenToWorld(out, 400, 200);
		expect(c.x).toBeCloseTo(100, 6);
		expect(c.y).toBeCloseTo(50, 6);
	});
});

describe('fitToContent', () => {
	it('centers the content with padding at the chosen scale', () => {
		const v = fitToContent({ w: 200, h: 100 }, { w: 600, h: 400 }, 50);
		expect(v.scale).toBeCloseTo(2.5, 6);
		expect(v.tx).toBeCloseTo(50, 6);
		expect(v.ty).toBeCloseTo(75, 6);
	});

	it('handles zero-sized content without dividing by zero', () => {
		const v = fitToContent({ w: 0, h: 0 }, { w: 600, h: 400 });
		expect(Number.isFinite(v.scale)).toBe(true);
		expect(Number.isFinite(v.tx)).toBe(true);
	});

	it('clamps the fit scale to MAX_SCALE for tiny content', () => {
		const v = fitToContent({ w: 1, h: 1 }, { w: 1000, h: 1000 }, 0);
		expect(v.scale).toBe(MAX_SCALE);
	});
});

describe('viewportWorldRect', () => {
	it('matches the inverse-screen-to-world conversion', () => {
		const v: ViewportState = { tx: 40, ty: 60, scale: 2 };
		const r = viewportWorldRect(v, 800, 400);
		expect(r.x).toBe(-20);
		expect(r.y).toBe(-30);
		expect(r.w).toBe(400);
		expect(r.h).toBe(200);
		const br = screenToWorld(v, 800, 400);
		expect(r.x + r.w).toBeCloseTo(br.x, 6);
		expect(r.y + r.h).toBeCloseTo(br.y, 6);
	});
});

describe('rectsOverlap', () => {
	it('detects edge-touching as no overlap (open intervals)', () => {
		const a = { x: 0, y: 0, w: 10, h: 10 };
		const b = { x: 10, y: 0, w: 10, h: 10 };
		expect(rectsOverlap(a, b)).toBe(false);
	});
	it('detects 1-px interior overlap', () => {
		expect(rectsOverlap({ x: 0, y: 0, w: 11, h: 11 }, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
	});
});

describe('hitTest', () => {
	const c = card('a', 10, 20, 200, HEADER_H + ROW_H * 2);
	const layout: LayoutResult = { cards: [c], edges: [], width: 0, height: 0 };

	it('returns title for points inside the header strip', () => {
		const h = hitTest(layout, 100, 30);
		expect(h?.kind).toBe('title');
	});
	it('returns card for body points below the header', () => {
		const h = hitTest(layout, 100, 20 + HEADER_H + 4);
		expect(h?.kind).toBe('card');
	});
	it('returns null outside any card', () => {
		expect(hitTest(layout, -5, -5)).toBeNull();
		expect(hitTest(layout, 1000, 1000)).toBeNull();
	});

	it('hits the port circle for expandable rows', () => {
		const cardWithExpandable = card('b', 0, 0, 100, HEADER_H + ROW_H);
		cardWithExpandable.rows = [
			{
				key: 'k',
				value: '{…}',
				valueKind: 'object',
				colorHex: null,
				container: true,
				expandable: true,
				childPath: [],
				children: [],
			},
		];
		const lay: LayoutResult = { cards: [cardWithExpandable], edges: [], width: 0, height: 0 };
		const portX = cardWithExpandable.w;
		const portY = HEADER_H + 0.5 * ROW_H;
		const h = hitTest(lay, portX, portY);
		expect(h?.kind).toBe('port');
		if (h?.kind === 'port') expect(h.rowIndex).toBe(0);
	});

	it('does not hit a port on a non-expandable row', () => {
		const cardNoPort = card('c', 0, 0, 100, HEADER_H + ROW_H);
		cardNoPort.rows = [
			{
				key: 'k',
				value: '42',
				valueKind: 'number',
				colorHex: null,
				container: false,
				expandable: false,
				childPath: [],
				children: [],
			},
		];
		const lay: LayoutResult = { cards: [cardNoPort], edges: [], width: 0, height: 0 };
		const portX = cardNoPort.w;
		const portY = HEADER_H + 0.5 * ROW_H;
		const h = hitTest(lay, portX, portY);
		expect(h?.kind === 'port' ? false : true).toBe(true);
	});
});
