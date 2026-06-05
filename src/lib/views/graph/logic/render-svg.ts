import { HEADER_H, ROW_H, type CardRow, type LayoutResult, type PositionedCard } from './layout';
import { hueColor, mixHex, type GraphTheme } from './theme';

const CARD_RADIUS = 6;
const FONT_PX = 13;
const HEADER_FONT_WEIGHT = 600;
const ROW_PAD_X = 11;
const SWATCH_W = 11;
const SWATCH_GAP = 6;
const PORT_R = 8;
const PORT_RESERVE = 18;

export function exportLayoutSVG(
	layout: LayoutResult,
	theme: GraphTheme,
	edgeStyle: 'elbow' | 'curve' = 'elbow',
	margin = 16,
): string {
	const measurer = createMeasurer(theme.monoFamily);
	const bounds = contentBounds(layout);
	const w = bounds.maxX - bounds.minX + margin * 2;
	const h = bounds.maxY - bounds.minY + margin * 2;
	const ox = margin - bounds.minX;
	const oy = margin - bounds.minY;
	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="xMidYMid meet" font-family="${esc(theme.monoFamily)}" font-size="${FONT_PX}">`,
	);
	parts.push(`<rect width="${n(w)}" height="${n(h)}" fill="${esc(theme.bg)}"/>`);
	parts.push(`<g transform="translate(${n(ox)},${n(oy)})">`);

	parts.push(
		`<g fill="none" stroke="${esc(theme.rule2)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`,
	);
	for (const e of layout.edges) {
		if (edgeStyle === 'curve') {
			const cx = (e.x1 + e.x2) / 2;
			parts.push(
				`<path d="M${n(e.x1)} ${n(e.y1)} C${n(cx)} ${n(e.y1)}, ${n(cx)} ${n(e.y2)}, ${n(e.x2)} ${n(e.y2)}"/>`,
			);
		} else {
			const midX = e.x1 + Math.max(16, (e.x2 - e.x1) / 2);
			parts.push(
				`<path d="M${n(e.x1)} ${n(e.y1)} L${n(midX)} ${n(e.y1)} L${n(midX)} ${n(e.y2)} L${n(e.x2)} ${n(e.y2)}"/>`,
			);
		}
	}
	parts.push('</g>');

	for (let i = 0; i < layout.cards.length; i++) {
		renderCardSVG(layout.cards[i], i, theme, measurer, parts);
	}

	parts.push('</g></svg>');
	return parts.join('');
}

function renderCardSVG(
	card: PositionedCard,
	cardIdx: number,
	theme: GraphTheme,
	measurer: TextMeasurer,
	out: string[],
): void {
	const accent = hueColor(theme, card.hue);
	const headerTint = theme.isLight ? 0.22 : 0.14;
	const headerRuleTint = theme.isLight ? 0.45 : 0.32;

	out.push(
		`<rect x="${n(card.x)}" y="${n(card.y)}" width="${n(card.w)}" height="${n(card.h)}" rx="${CARD_RADIUS}" fill="${esc(theme.bgElev)}" stroke="${esc(theme.rule2)}"/>`,
	);

	const r = CARD_RADIUS;
	out.push(
		`<path d="M${n(card.x + r)} ${n(card.y)} L${n(card.x + card.w - r)} ${n(card.y)} A${r} ${r} 0 0 1 ${n(card.x + card.w)} ${n(card.y + r)} L${n(card.x + card.w)} ${n(card.y + HEADER_H)} L${n(card.x)} ${n(card.y + HEADER_H)} L${n(card.x)} ${n(card.y + r)} A${r} ${r} 0 0 1 ${n(card.x + r)} ${n(card.y)} Z" fill="${esc(mixHex(theme.bgElev, accent, headerTint))}"/>`,
	);

	out.push(
		`<line x1="${n(card.x)}" y1="${n(card.y + HEADER_H)}" x2="${n(card.x + card.w)}" y2="${n(card.y + HEADER_H)}" stroke="${esc(mixHex(theme.bgElev, accent, headerRuleTint))}"/>`,
	);

	const titleMax = card.w - ROW_PAD_X * 2;
	const title = fitText(measurer.title, card.title, titleMax);
	out.push(
		`<text x="${n(card.x + ROW_PAD_X)}" y="${n(card.y + HEADER_H / 2)}" fill="${esc(accent)}" font-weight="${HEADER_FONT_WEIGHT}" dominant-baseline="middle">${esc(title)}</text>`,
	);

	for (let i = 0; i < card.rows.length; i++) {
		const row = card.rows[i];
		const rowY = card.y + HEADER_H + i * ROW_H;
		if (i < card.rows.length - 1) {
			out.push(
				`<line x1="${n(card.x)}" y1="${n(rowY + ROW_H)}" x2="${n(card.x + card.w)}" y2="${n(rowY + ROW_H)}" stroke="${esc(theme.rule)}"/>`,
			);
		}
		renderRowSVG(card, cardIdx, i, row, rowY, accent, theme, measurer, out);
	}
}

function renderRowSVG(
	card: PositionedCard,
	cardIdx: number,
	rowIdx: number,
	row: CardRow,
	rowY: number,
	accent: string,
	theme: GraphTheme,
	measurer: TextMeasurer,
	out: string[],
): void {
	const midY = rowY + ROW_H / 2;
	let cursorX = card.x + ROW_PAD_X;

	out.push(
		`<text x="${n(cursorX)}" y="${n(midY)}" fill="${esc(accent)}" dominant-baseline="middle">${esc(row.key)}</text>`,
	);
	cursorX += measurer.body.measure(row.key);

	out.push(
		`<text x="${n(cursorX)}" y="${n(midY)}" fill="${esc(theme.textFaint)}" dominant-baseline="middle">:</text>`,
	);
	cursorX += measurer.body.measure(': ');

	if (row.colorHex) {
		const stroke = theme.isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.2)';
		out.push(
			`<rect x="${n(cursorX)}" y="${n(midY - SWATCH_W / 2)}" width="${SWATCH_W}" height="${SWATCH_W}" fill="${esc(row.colorHex)}" stroke="${stroke}"/>`,
		);
		cursorX += SWATCH_W + SWATCH_GAP;
	}

	const valColor = valueColor(row, theme);
	const portReserve = row.expandable ? PORT_RESERVE : 0;
	const valMax = card.x + card.w - cursorX - ROW_PAD_X - portReserve;
	const valText = fitText(measurer.body, row.value, Math.max(20, valMax));
	out.push(
		`<text x="${n(cursorX)}" y="${n(midY)}" fill="${esc(valColor)}" dominant-baseline="middle">${esc(valText)}</text>`,
	);

	if (row.expandable) {
		const portX = card.x + card.w;
		const open = row.children.length > 0;
		const ring = open ? accent : theme.rule2;
		const cross = open ? accent : theme.textDim;
		out.push(
			`<circle cx="${n(portX)}" cy="${n(midY)}" r="${PORT_R}" fill="${esc(theme.bgElev3)}" stroke="${esc(ring)}"/>`,
		);
		out.push(
			`<line x1="${n(portX - 4)}" y1="${n(midY)}" x2="${n(portX + 4)}" y2="${n(midY)}" stroke="${esc(cross)}" stroke-width="1.4" stroke-linecap="round"/>`,
		);
		if (!open) {
			out.push(
				`<line x1="${n(portX)}" y1="${n(midY - 4)}" x2="${n(portX)}" y2="${n(midY + 4)}" stroke="${esc(cross)}" stroke-width="1.4" stroke-linecap="round"/>`,
			);
		}
	}

	void cardIdx;
	void rowIdx;
}

function valueColor(row: CardRow, theme: GraphTheme): string {
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

interface MeasureCtx {
	measure: (s: string) => number;
}

interface TextMeasurer {
	title: MeasureCtx;
	body: MeasureCtx;
}

function createMeasurer(family: string): TextMeasurer {
	const canvas = document.createElement('canvas');
	const titleCtx = canvas.getContext('2d');
	const bodyCanvas = document.createElement('canvas');
	const bodyCtx = bodyCanvas.getContext('2d');
	if (titleCtx) titleCtx.font = `${HEADER_FONT_WEIGHT} ${FONT_PX}px ${family}`;
	if (bodyCtx) bodyCtx.font = `${FONT_PX}px ${family}`;
	const titleCache = new Map<string, number>();
	const bodyCache = new Map<string, number>();
	return {
		title: {
			measure: (s) => {
				const hit = titleCache.get(s);
				if (hit !== undefined) return hit;
				const w = titleCtx ? titleCtx.measureText(s).width : s.length * 7.8;
				titleCache.set(s, w);
				return w;
			},
		},
		body: {
			measure: (s) => {
				const hit = bodyCache.get(s);
				if (hit !== undefined) return hit;
				const w = bodyCtx ? bodyCtx.measureText(s).width : s.length * 7.8;
				bodyCache.set(s, w);
				return w;
			},
		},
	};
}

function fitText(m: MeasureCtx, text: string, maxWidth: number): string {
	if (maxWidth <= 0) return '';
	if (m.measure(text) <= maxWidth) return text;
	const ell = '…';
	const ellWidth = m.measure(ell);
	if (ellWidth > maxWidth) return '';
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (m.measure(text.slice(0, mid)) + ellWidth <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + ell;
}

function contentBounds(layout: LayoutResult): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	const PORT_OUTER = 9; // port radius + ~1px stroke
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const c of layout.cards) {
		if (c.x < minX) minX = c.x;
		if (c.y < minY) minY = c.y;
		if (c.y + c.h > maxY) maxY = c.y + c.h;
		const hasPort = c.rows.some((r) => r.expandable);
		const right = c.x + c.w + (hasPort ? PORT_OUTER : 0);
		if (right > maxX) maxX = right;
	}
	if (!isFinite(minX)) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}
	return { minX, minY, maxX, maxY };
}

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function n(x: number): string {
	return (Math.round(x * 100) / 100).toString();
}
