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
	const state: Record<string | symbol, unknown> = {};
	const ctx = new Proxy(state, {
		get(target, key) {
			if (key === 'stroke') return () => strokes.push(target.strokeStyle);
			if (key === 'measureText') return (s: string) => ({ width: s.length * CHAR_W });
			if (key in target) return target[key];
			return () => {};
		},
		set(target, key, value) {
			target[key] = value;
			return true;
		},
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
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
