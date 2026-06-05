import type { CardRow } from './layout';
import type { LayoutResult, PositionedCard } from './layout';
import { HEADER_H, ROW_H } from './layout';

export interface ViewportState {
	tx: number;
	ty: number;
	scale: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 3.0;

export const PORT_R = 9;

export function clampScale(s: number): number {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

export function screenToWorld(v: ViewportState, sx: number, sy: number): { x: number; y: number } {
	return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
}

export function viewportWorldRect(v: ViewportState, screenW: number, screenH: number): Rect {
	return {
		x: -v.tx / v.scale,
		y: -v.ty / v.scale,
		w: screenW / v.scale,
		h: screenH / v.scale,
	};
}

export function pan(v: ViewportState, dxScreen: number, dyScreen: number): ViewportState {
	return { tx: v.tx + dxScreen, ty: v.ty + dyScreen, scale: v.scale };
}

export function zoomAt(
	v: ViewportState,
	anchorX: number,
	anchorY: number,
	factor: number,
): ViewportState {
	const next = clampScale(v.scale * factor);
	if (next === v.scale) return v;
	const k = next / v.scale;
	return {
		tx: anchorX - (anchorX - v.tx) * k,
		ty: anchorY - (anchorY - v.ty) * k,
		scale: next,
	};
}

export function centerOn(
	v: ViewportState,
	worldX: number,
	worldY: number,
	screenW: number,
	screenH: number,
): ViewportState {
	return {
		tx: screenW / 2 - worldX * v.scale,
		ty: screenH / 2 - worldY * v.scale,
		scale: v.scale,
	};
}

export function fitToContent(
	content: { w: number; h: number },
	screen: { w: number; h: number },
	padding = 48,
): ViewportState {
	if (content.w <= 0 || content.h <= 0 || screen.w <= 0 || screen.h <= 0) {
		return { tx: padding, ty: padding, scale: 1 };
	}
	const sx = (screen.w - padding * 2) / content.w;
	const sy = (screen.h - padding * 2) / content.h;
	const scale = clampScale(Math.min(sx, sy));
	return {
		tx: (screen.w - content.w * scale) / 2,
		ty: (screen.h - content.h * scale) / 2,
		scale,
	};
}

export type HitTarget =
	| { kind: 'title'; card: PositionedCard }
	| { kind: 'port'; card: PositionedCard; rowIndex: number; row: CardRow }
	| { kind: 'card'; card: PositionedCard }
	| null;

function pointInRect(x: number, y: number, r: Rect): boolean {
	return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function pointInCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
	const dx = x - cx;
	const dy = y - cy;
	return dx * dx + dy * dy <= r * r;
}

export function hitTest(layout: LayoutResult, wx: number, wy: number): HitTarget {
	for (let i = layout.cards.length - 1; i >= 0; i--) {
		const card = layout.cards[i];
		for (let r = 0; r < card.rows.length; r++) {
			const row = card.rows[r];
			if (!row.expandable) continue;
			const portX = card.x + card.w;
			const portY = card.y + HEADER_H + (r + 0.5) * ROW_H;
			if (pointInCircle(wx, wy, portX, portY, PORT_R + 2)) {
				return { kind: 'port', card, rowIndex: r, row };
			}
		}
		if (
			pointInRect(wx, wy, {
				x: card.x,
				y: card.y,
				w: card.w,
				h: HEADER_H,
			})
		) {
			return { kind: 'title', card };
		}
		if (pointInRect(wx, wy, card)) {
			return { kind: 'card', card };
		}
	}
	return null;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
