import { describe, it, expect } from 'vitest';
import { chipText, openBracket, renderKey, detectUrl } from './row-format';
import type { ContentRow } from './model';

function row(over: Partial<ContentRow>): ContentRow {
	return {
		variant: 'content',
		path: [],
		depth: 1,
		key: 'k',
		kind: 'string',
		preview: '""',
		childCount: null,
		sizeHint: 0,
		expanded: false,
		...over,
	};
}

describe('chipText', () => {
	it('pluralizes object props and arrays items', () => {
		expect(chipText(row({ kind: 'object', childCount: 1 }))).toBe('{1 prop}');
		expect(chipText(row({ kind: 'object', childCount: 3 }))).toBe('{3 props}');
		expect(chipText(row({ kind: 'array', childCount: 1 }))).toBe('[1 item]');
		expect(chipText(row({ kind: 'array', childCount: 12 }))).toBe('[12 items]');
	});

	it('uses the ellipsis chip when the count is unknown (lazy)', () => {
		expect(chipText(row({ kind: 'object', childCount: null }))).toBe('{…}');
		expect(chipText(row({ kind: 'array', childCount: null }))).toBe('[…]');
	});

	it('returns null for leaf kinds', () => {
		expect(chipText(row({ kind: 'string' }))).toBeNull();
		expect(chipText(row({ kind: 'number' }))).toBeNull();
	});
});

describe('openBracket', () => {
	it('picks the bracket by kind', () => {
		expect(openBracket(row({ kind: 'array' }))).toBe('[');
		expect(openBracket(row({ kind: 'object' }))).toBe('{');
	});
});

describe('renderKey', () => {
	it('renders root, indices, and string keys', () => {
		expect(renderKey(row({ depth: 0 }))).toBe('$');
		expect(renderKey(row({ depth: 2, key: 4 }))).toBe('[4]');
		expect(renderKey(row({ depth: 1, key: 'name' }))).toBe('name');
	});
});

describe('detectUrl', () => {
	it('extracts an http(s) URL from a quoted preview', () => {
		expect(detectUrl('"https://example.com/x"')).toBe('https://example.com/x');
		expect(detectUrl('"http://localhost:1420"')).toBe('http://localhost:1420');
	});

	it('returns null for non-URL or unquoted previews', () => {
		expect(detectUrl('"just a string"')).toBeNull();
		expect(detectUrl('https://no-quotes.com')).toBeNull();
		expect(detectUrl('42')).toBeNull();
	});
});
