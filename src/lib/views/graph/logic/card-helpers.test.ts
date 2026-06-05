import { describe, expect, it } from 'vitest';
import { containerPreview, hueOf, NHUES, scalarText, toRow } from './card-helpers';
import type { NodeView } from '$lib/ipc/types';

describe('containerPreview', () => {
	it('formats arrays with item counts', () => {
		expect(containerPreview('array', 0)).toBe('[]');
		expect(containerPreview('array', 1)).toBe('[1 item]');
		expect(containerPreview('array', 42)).toBe('[42 items]');
		expect(containerPreview('array', null)).toBe('[…]');
	});
	it('formats objects with key counts', () => {
		expect(containerPreview('object', 0)).toBe('{}');
		expect(containerPreview('object', 1)).toBe('{1 key}');
		expect(containerPreview('object', 42)).toBe('{42 keys}');
		expect(containerPreview('object', null)).toBe('{…}');
	});
});

describe('scalarText', () => {
	function v(kind: NodeView['kind'], preview: string): NodeView {
		return { key: 0, kind, preview, childCount: null, sizeHint: 0 };
	}
	it('strips JSON quotes around string previews', () => {
		expect(scalarText(v('string', '"hello"'))).toBe('hello');
	});
	it('leaves non-string previews alone', () => {
		expect(scalarText(v('number', '42'))).toBe('42');
		expect(scalarText(v('bool', 'true'))).toBe('true');
		expect(scalarText(v('null', 'null'))).toBe('null');
	});
	it('handles unterminated string previews defensively', () => {
		expect(scalarText(v('string', '"truncate…'))).toBe('truncate…');
	});
});

describe('hueOf', () => {
	it('returns a hue in [0, NHUES) for any path', () => {
		const paths = [[], ['a'], ['a', 'b'], ['items', 0], ['items', 0, 'name']];
		for (const p of paths) {
			const h = hueOf(p);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThan(NHUES);
			expect(Number.isInteger(h)).toBe(true);
		}
	});
	it('gives same-typed array siblings the same hue', () => {
		expect(hueOf(['fruits', 0])).toBe(hueOf(['fruits', 1]));
		expect(hueOf(['fruits', 0])).toBe(hueOf(['fruits', 99]));
	});
	it('gives different parent keys different hue buckets (probabilistically)', () => {
		const a = hueOf(['details']);
		const b = hueOf(['nutrients']);
		const c = hueOf(['ingredients']);
		expect(new Set([a, b, c]).size).toBeGreaterThan(1);
	});
});

describe('toRow', () => {
	function v(
		key: NodeView['key'],
		kind: NodeView['kind'],
		preview: string,
		childCount: number | null = null,
	): NodeView {
		return { key, kind, preview, childCount, sizeHint: 0 };
	}
	it('builds a primitive row with the right kind + value', () => {
		const r = toRow(['parent'], v('age', 'number', '42'));
		expect(r.key).toBe('age');
		expect(r.valueKind).toBe('number');
		expect(r.value).toBe('42');
		expect(r.container).toBe(false);
		expect(r.expandable).toBe(false);
		expect(r.children).toEqual([]);
		expect(r.childPath).toEqual(['parent', 'age']);
	});
	it('marks containers with childCount > 0 as expandable', () => {
		const r = toRow([], v('items', 'array', '[…]', 5));
		expect(r.container).toBe(true);
		expect(r.expandable).toBe(true);
		expect(r.value).toBe('[5 items]');
	});
	it('marks empty containers as container but not expandable', () => {
		const r = toRow([], v('empty', 'array', '[]', 0));
		expect(r.container).toBe(true);
		expect(r.expandable).toBe(false);
	});
	it('extracts a hex color swatch when the value is a hex string', () => {
		const r = toRow([], v('color', 'string', '"#ff6a3a"'));
		expect(r.colorHex).toBe('#ff6a3a');
	});
	it('uses `[i]` row labels for array indices', () => {
		const r = toRow(['items'], v(2, 'string', '"a"'));
		expect(r.key).toBe('[2]');
	});
});
