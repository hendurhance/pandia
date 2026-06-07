import { HEADER_H, ROW_H, type LayoutResult, type PositionedCard } from './layout';
import { hueColor, mixHex, type GraphTheme } from './theme';
import { rectsOverlap, type Rect, type ViewportState } from './viewport';

const LOD_NO_TEXT = 0.45;

const LOD_BLOCK_ONLY = 0.22;

const CARD_RADIUS = 6;
const FONT_PX = 13;
const HEADER_FONT_WEIGHT = 600;
const ROW_PAD_X = 11; // matches legacy .card-row padding (0.7rem ≈ 11.2px)
const SWATCH_W = 11;
const SWATCH_GAP = 6;

export type EdgeStyle = 'elbow' | 'curve';

export interface PaintOpts {
	ctx: CanvasRenderingContext2D;
	layout: LayoutResult;
	viewport: ViewportState;

	screenW: number;
	screenH: number;
	theme: GraphTheme;
	dpr: number;

	highlightCardId?: string | null;

	edgeStyle?: EdgeStyle;
}

export function paintFrame(opts: PaintOpts): void {
	const { ctx, theme, screenW, screenH, viewport, layout, dpr } = opts;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, screenW * dpr, screenH * dpr);
	ctx.scale(dpr, dpr);

	ctx.fillStyle = theme.bg;
	ctx.fillRect(0, 0, screenW, screenH);

	paintGrid(ctx, viewport, screenW, screenH, theme);

	ctx.translate(viewport.tx, viewport.ty);
	ctx.scale(viewport.scale, viewport.scale);

	const visible: Rect = {
		x: -viewport.tx / viewport.scale,
		y: -viewport.ty / viewport.scale,
		w: screenW / viewport.scale,
		h: screenH / viewport.scale,
	};

	paintEdges(ctx, layout, visible, viewport.scale, theme, opts.edgeStyle ?? 'elbow');

	const highlightId = opts.highlightCardId ?? null;
	for (const card of layout.cards) {
		if (!rectsOverlap(card, visible)) continue;
		paintCard(ctx, card, viewport.scale, theme, card.id === highlightId, visible);
	}
}

function visibleRowRange(card: PositionedCard, visible: Rect): { first: number; last: number } {
	const topY = visible.y - card.y - HEADER_H;
	const botY = visible.y + visible.h - card.y - HEADER_H;
	const first = Math.max(0, Math.floor(topY / ROW_H));
	const last = Math.min(card.rows.length, Math.ceil(botY / ROW_H));
	return { first, last };
}

function paintGrid(
	ctx: CanvasRenderingContext2D,
	v: ViewportState,
	screenW: number,
	screenH: number,
	theme: GraphTheme,
): void {
	const baseSpacing = 22; // world px between dots — matches legacy background-size
	let spacing = baseSpacing * v.scale;
	while (spacing < 12) spacing *= 2;

	const offsetX = ((v.tx % spacing) + spacing) % spacing;
	const offsetY = ((v.ty % spacing) + spacing) % spacing;

	ctx.fillStyle = theme.rule2;
	ctx.globalAlpha = 0.55;
	ctx.beginPath();
	for (let x = offsetX; x < screenW; x += spacing) {
		for (let y = offsetY; y < screenH; y += spacing) {
			ctx.moveTo(x + 0.6, y);
			ctx.arc(x, y, 0.6, 0, Math.PI * 2);
		}
	}
	ctx.fill();
	ctx.globalAlpha = 1;
}

function paintEdges(
	ctx: CanvasRenderingContext2D,
	layout: LayoutResult,
	visible: Rect,
	scale: number,
	theme: GraphTheme,
	edgeStyle: EdgeStyle,
): void {
	ctx.strokeStyle = theme.rule2;
	ctx.lineWidth = 1.5 / scale; // keep visual weight constant across zoom
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	const pad = 64;
	const visPadded: Rect = {
		x: visible.x - pad,
		y: visible.y - pad,
		w: visible.w + pad * 2,
		h: visible.h + pad * 2,
	};

	ctx.beginPath();
	for (const e of layout.edges) {
		const minX = Math.min(e.x1, e.x2);
		const maxX = Math.max(e.x1, e.x2);
		const minY = Math.min(e.y1, e.y2);
		const maxY = Math.max(e.y1, e.y2);
		if (maxX < visPadded.x || minX > visPadded.x + visPadded.w) continue;
		if (maxY < visPadded.y || minY > visPadded.y + visPadded.h) continue;

		if (edgeStyle === 'curve') {
			const cx = (e.x1 + e.x2) / 2;
			ctx.moveTo(e.x1, e.y1);
			ctx.bezierCurveTo(cx, e.y1, cx, e.y2, e.x2, e.y2);
		} else {
			const midX = e.x1 + Math.max(16, (e.x2 - e.x1) / 2);
			ctx.moveTo(e.x1, e.y1);
			ctx.lineTo(midX, e.y1);
			ctx.lineTo(midX, e.y2);
			ctx.lineTo(e.x2, e.y2);
		}
	}
	ctx.stroke();
}

function paintCard(
	ctx: CanvasRenderingContext2D,
	card: PositionedCard,
	scale: number,
	theme: GraphTheme,
	highlighted: boolean,
	visible: Rect,
): void {
	const accent = hueColor(theme, card.hue);
	const blockTint = theme.isLight ? 0.26 : 0.18;
	const headerTint = theme.isLight ? 0.22 : 0.14;
	const headerRuleTint = theme.isLight ? 0.45 : 0.32;

	if (scale < LOD_BLOCK_ONLY) {
		ctx.fillStyle = mixHex(theme.bgElev, accent, blockTint);
		roundRectPath(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
		ctx.fill();
		if (highlighted) paintHighlightRing(ctx, card, scale, theme);
		return;
	}

	ctx.fillStyle = theme.bgElev;
	roundRectPath(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
	ctx.fill();

	ctx.strokeStyle = theme.rule2;
	ctx.lineWidth = 1 / scale;
	ctx.stroke();

	ctx.save();
	roundRectPath(ctx, card.x, card.y, card.w, HEADER_H, CARD_RADIUS, true);
	ctx.clip();
	ctx.fillStyle = mixHex(theme.bgElev, accent, headerTint);
	ctx.fillRect(card.x, card.y, card.w, HEADER_H);
	ctx.restore();

	ctx.strokeStyle = mixHex(theme.bgElev, accent, headerRuleTint);
	ctx.lineWidth = 1 / scale;
	ctx.beginPath();
	ctx.moveTo(card.x, card.y + HEADER_H);
	ctx.lineTo(card.x + card.w, card.y + HEADER_H);
	ctx.stroke();

	const { first, last } = visibleRowRange(card, visible);

	if (scale < LOD_NO_TEXT) {
		ctx.fillStyle = theme.rule;
		for (let i = Math.max(1, first); i < last; i++) {
			const y = card.y + HEADER_H + i * ROW_H;
			ctx.fillRect(card.x + ROW_PAD_X, y, card.w - ROW_PAD_X * 2, 0.5 / scale);
		}
		return;
	}

	ctx.font = `${HEADER_FONT_WEIGHT} ${FONT_PX}px ${theme.monoFamily}`;
	ctx.fillStyle = accent;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	const titleText = fitText(ctx, card.title, card.w - ROW_PAD_X * 2);
	ctx.fillText(titleText, card.x + ROW_PAD_X, card.y + HEADER_H / 2);

	ctx.font = `${FONT_PX}px ${theme.monoFamily}`;

	for (let i = first; i < last; i++) {
		const row = card.rows[i];
		const rowY = card.y + HEADER_H + i * ROW_H;

		if (i < card.rows.length - 1) {
			ctx.strokeStyle = theme.rule;
			ctx.lineWidth = 1 / scale;
			ctx.beginPath();
			ctx.moveTo(card.x, rowY + ROW_H);
			ctx.lineTo(card.x + card.w, rowY + ROW_H);
			ctx.stroke();
		}

		paintRow(ctx, card, row, rowY, accent, scale, theme);
	}

	if (highlighted) paintHighlightRing(ctx, card, scale, theme);
}

function paintHighlightRing(
	ctx: CanvasRenderingContext2D,
	card: PositionedCard,
	scale: number,
	theme: GraphTheme,
): void {
	const pad = 3 / scale;
	ctx.strokeStyle = theme.accent;
	ctx.lineWidth = 2 / scale;
	roundRectPath(
		ctx,
		card.x - pad,
		card.y - pad,
		card.w + pad * 2,
		card.h + pad * 2,
		CARD_RADIUS + pad,
	);
	ctx.stroke();
}

function paintRow(
	ctx: CanvasRenderingContext2D,
	card: PositionedCard,
	row: PositionedCard['rows'][number],
	rowY: number,
	accent: string,
	scale: number,
	theme: GraphTheme,
): void {
	const midY = rowY + ROW_H / 2;
	let cursorX = card.x + ROW_PAD_X;

	ctx.fillStyle = accent;
	ctx.fillText(row.key, cursorX, midY);
	cursorX += ctx.measureText(row.key).width;

	ctx.fillStyle = theme.textFaint;
	ctx.fillText(':', cursorX, midY);
	cursorX += ctx.measureText(': ').width;

	if (row.colorHex) {
		ctx.fillStyle = row.colorHex;
		ctx.fillRect(cursorX, midY - SWATCH_W / 2, SWATCH_W, SWATCH_W);
		ctx.strokeStyle = theme.isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.2)';
		ctx.lineWidth = 1 / scale;
		ctx.strokeRect(cursorX, midY - SWATCH_W / 2, SWATCH_W, SWATCH_W);
		cursorX += SWATCH_W + SWATCH_GAP;
	}

	const valColor = valueColor(row, theme);
	ctx.fillStyle = valColor;
	const portReserve = row.expandable ? 18 : 0;
	const valMaxWidth = card.x + card.w - cursorX - ROW_PAD_X - portReserve;
	const valText = fitText(ctx, row.value, Math.max(20, valMaxWidth));
	ctx.fillText(valText, cursorX, midY);

	if (row.expandable) {
		const portX = card.x + card.w;
		const open = row.children.length > 0;
		ctx.beginPath();
		ctx.arc(portX, midY, 8, 0, Math.PI * 2);
		ctx.fillStyle = theme.bgElev3;
		ctx.fill();
		ctx.strokeStyle = open ? accent : theme.rule2;
		ctx.lineWidth = 1 / scale;
		ctx.stroke();
		ctx.strokeStyle = open ? accent : theme.textDim;
		ctx.lineWidth = 1.4 / scale;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(portX - 4, midY);
		ctx.lineTo(portX + 4, midY);
		if (!open) {
			ctx.moveTo(portX, midY - 4);
			ctx.lineTo(portX, midY + 4);
		}
		ctx.stroke();
	}
}

function valueColor(row: PositionedCard['rows'][number], theme: GraphTheme): string {
	if (row.container) return theme.textDim;
	switch (row.valueKind) {
		case 'string':
			return theme.text;
		case 'number':
			return theme.syntaxNumber;
		case 'bool':
			return theme.syntaxBoolean;
		case 'null':
			return theme.syntaxNull;
		default:
			return theme.text;
	}
}

function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	topOnly = false,
): void {
	const br = topOnly ? 0 : r;
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - br);
	ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
	ctx.lineTo(x + br, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - br);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

export interface RasterPlan {
	ratio: number;
	layoutScale: number;
	canvasW: number;
	canvasH: number;
	downscaled: boolean;
}

const RASTER_MAX_DIM = 16384;
const RASTER_MAX_AREA = 64_000_000;

export function planRasterExport(
	layout: { width: number; height: number },
	margin = 40,
): RasterPlan {
	const w = layout.width + margin * 2;
	const h = layout.height + margin * 2;
	const dimCap = Math.min(RASTER_MAX_DIM / w, RASTER_MAX_DIM / h);
	const areaCap = Math.sqrt(RASTER_MAX_AREA / Math.max(1, w * h));
	const maxFactor = Math.min(dimCap, areaCap);
	for (const r of [4, 3, 2, 1]) {
		if (r <= maxFactor) {
			return {
				ratio: r,
				layoutScale: 1,
				canvasW: Math.max(1, Math.round(w * r)),
				canvasH: Math.max(1, Math.round(h * r)),
				downscaled: false,
			};
		}
	}
	const fit = Math.max(0.05, maxFactor);
	return {
		ratio: 1,
		layoutScale: fit,
		canvasW: Math.max(1, Math.floor(w * fit)),
		canvasH: Math.max(1, Math.floor(h * fit)),
		downscaled: true,
	};
}

export function paintFullLayout(
	layout: LayoutResult,
	theme: GraphTheme,
	pixelRatio = 2,
	margin = 40,
): HTMLCanvasElement {
	const plan = planRasterExport(layout, margin);
	const ratio =
		plan.layoutScale === 1 ? Math.max(1, Math.min(plan.ratio, Math.round(pixelRatio))) : plan.ratio;
	const layoutScale = plan.layoutScale;
	const logicalW = Math.ceil((layout.width + margin * 2) * layoutScale);
	const logicalH = Math.ceil((layout.height + margin * 2) * layoutScale);
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, logicalW * ratio);
	canvas.height = Math.max(1, logicalH * ratio);
	const ctx = canvas.getContext('2d');
	if (!ctx) return canvas;
	paintFrame({
		ctx,
		layout,
		viewport: { tx: margin * layoutScale, ty: margin * layoutScale, scale: layoutScale },
		screenW: logicalW,
		screenH: logicalH,
		theme,
		dpr: ratio,
	});
	return canvas;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (maxWidth <= 0) return '';
	if (ctx.measureText(text).width <= maxWidth) return text;
	const ell = '…';
	const ellWidth = ctx.measureText(ell).width;
	if (ellWidth > maxWidth) return ''; // can't even fit the ellipsis
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid)).width + ellWidth <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + ell;
}
