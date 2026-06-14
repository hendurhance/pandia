import { describe, it, expect } from 'vitest';
import { fuzzyMatch, highlightLabel } from './match';

describe('fuzzyMatch', () => {
	it('treats an empty query as a match with no ranges', () => {
		expect(fuzzyMatch('', 'anything')).toEqual({ score: 1, ranges: [] });
	});
	it('never matches a non-empty query against an empty label', () => {
		expect(fuzzyMatch('x', '')).toEqual({ score: 0, ranges: [] });
	});
	it('returns no match when a query char is absent', () => {
		expect(fuzzyMatch('xyz', 'abc')).toEqual({ score: 0, ranges: [] });
	});
	it('collapses a contiguous match into one range', () => {
		const r = fuzzyMatch('foo', 'foobar');
		expect(r.ranges).toEqual([[0, 3]]);
		expect(r.score).toBeGreaterThan(0);
	});
	it('records scattered subsequence matches as separate ranges', () => {
		expect(fuzzyMatch('fb', 'foo bar').ranges).toEqual([
			[0, 1],
			[4, 5],
		]);
	});
	it('matches case-insensitively', () => {
		expect(fuzzyMatch('FB', 'foo bar').ranges).toEqual([
			[0, 1],
			[4, 5],
		]);
	});
	it('scores a contiguous match higher than a scattered one', () => {
		expect(fuzzyMatch('abc', 'abcdef').score).toBeGreaterThan(fuzzyMatch('abc', 'axbxc').score);
	});
	it('never exceeds a score of 1', () => {
		expect(fuzzyMatch('a', 'a').score).toBeLessThanOrEqual(1);
	});
});

describe('highlightLabel', () => {
	it('escapes the whole label and adds no marks when there are no ranges', () => {
		expect(highlightLabel('a < b & "c"', [])).toBe('a &lt; b &amp; &quot;c&quot;');
	});
	it('wraps a single range in <mark> and escapes the remainder', () => {
		expect(highlightLabel('foobar', [[0, 3]])).toBe('<mark>foo</mark>bar');
	});
	it('handles multiple ranges', () => {
		expect(
			highlightLabel('foo bar', [
				[0, 1],
				[4, 5],
			]),
		).toBe('<mark>f</mark>oo <mark>b</mark>ar');
	});
	it('escapes both inside and outside the marks', () => {
		expect(highlightLabel('<a>', [[0, 1]])).toBe('<mark>&lt;</mark>a&gt;');
	});
});
