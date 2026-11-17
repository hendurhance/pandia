// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout';
import { toRow } from './card-helpers';
import { fitText, paintFrame } from './render';
import { exportLayoutSVG } from './render-svg';
import { readGraphTheme } from './theme';

// jsdom has no canvas; the SVG export falls back to a fixed width per UTF-16 unit.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const CHAR_W = 7;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function recordingCtx() {
	const strokes: unknown[] = [];
	const texts: { text: string; x: number }[] = [];
	const state: Record<string | symbol, unknown> = {};
	const ctx = new Proxy(state, {
		get(target, key) {
			if (key === 'stroke') return () => strokes.push(target.strokeStyle);
			if (key === 'fillText') return (text: string, x: number) => texts.push({ text, x });
			if (key === 'measureText') return (s: string) => ({ width: s.length * CHAR_W });
			if (key in target) return target[key];
			return () => {};
		},
		set(target, key, value) {
			target[key] = value;
			return true;
		},
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, texts };
}

function stringRows(values: Record<string, string>) {
	const rows = Object.entries(values).map(([key, v]) =>
		toRow([], { key, kind: 'string', preview: JSON.stringify(v), childCount: null }),
	);
	return layoutGraph({ id: '[]', path: [], title: 'root', kind: 'object', rows, hue: 0 });
}

describe('paintFrame — search highlight', () => {
	it.each([0.1, 0.3, 1])('rings the highlighted card at %f zoom', (scale) => {
		const theme = readGraphTheme();
		const layout = stringRows({ a: 'x' });
		const { ctx, strokes } = recordingCtx();
		paintFrame({
			ctx,
			layout,
			viewport: { tx: 0, ty: 0, scale },
			screenW: 800,
			screenH: 600,
			theme,
			dpr: 1,
			highlightCardId: layout.cards[0]!.id,
		});
		expect(strokes).toContain(theme.accent);
	});
});

describe('edges', () => {
	it('draw in the faint text colour, which reads against the canvas', () => {
		const theme = readGraphTheme();
		const layout = stringRows({ a: 'x' });
		const { ctx, strokes } = recordingCtx();
		paintFrame({
			ctx,
			layout,
			viewport: { tx: 0, ty: 0, scale: 1 },
			screenW: 800,
			screenH: 600,
			theme,
			dpr: 1,
			highlightCardId: null,
		});
		expect(strokes[0]).toBe(theme.textFaint);
		expect(exportLayoutSVG(layout, theme)).toContain(
			`<g fill="none" stroke="${theme.textFaint}" stroke-width="1.5"`,
		);
	});
});

describe('truncated emoji labels', () => {
	const emoji = '😀'.repeat(60);

	it('canvas text never ends in half an emoji', () => {
		const { ctx } = recordingCtx();
		for (const width of [30, 37, 44]) {
			expect(fitText(ctx, emoji, width)).not.toMatch(LONE_SURROGATE);
		}
	});

	it('SVG text never ends in half an emoji', () => {
		const svg = exportLayoutSVG(stringRows({ a: emoji, b: `x${emoji}` }), readGraphTheme());
		expect(svg).not.toMatch(LONE_SURROGATE);
	});
});

describe('a long key', () => {
	const layout = stringRows({ ['k'.repeat(60)]: 'true' });
	const card = layout.cards[0]!;

	it('stays inside its card on the canvas', () => {
		const { ctx, texts } = recordingCtx();
		paintFrame({
			ctx,
			layout,
			viewport: { tx: 0, ty: 0, scale: 1 },
			screenW: 800,
			screenH: 600,
			theme: readGraphTheme(),
			dpr: 1,
		});
		for (const t of texts) {
			expect(t.x + t.text.length * CHAR_W).toBeLessThanOrEqual(card.x + card.w);
		}
	});

	it('stays inside its card in SVG export', () => {
		const svg = exportLayoutSVG(layout, readGraphTheme(), 'elbow', 0);
		const texts = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)];
		expect(texts.length).toBeGreaterThan(0);
		for (const [, x, text] of texts) {
			expect(Number(x) + text!.length * 7.8).toBeLessThanOrEqual(card.x + card.w);
		}
	});
});
