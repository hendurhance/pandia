import { describe, it, expect } from 'vitest';
import { fuzzyMatch, highlightSegments } from './match';

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

describe('highlightSegments', () => {
	it('returns the whole label as one plain segment when nothing matched', () => {
		expect(highlightSegments('a < b', [])).toEqual([{ text: 'a < b', hit: false }]);
	});
	it('marks each matched range and keeps the text around it', () => {
		expect(
			highlightSegments('foo bar', [
				[0, 1],
				[4, 5],
			]),
		).toEqual([
			{ text: 'f', hit: true },
			{ text: 'oo ', hit: false },
			{ text: 'b', hit: true },
			{ text: 'ar', hit: false },
		]);
	});
	it('leaves out empty segments at the edges', () => {
		expect(highlightSegments('foo', [[0, 3]])).toEqual([{ text: 'foo', hit: true }]);
	});
});
