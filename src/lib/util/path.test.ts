import { describe, it, expect } from 'vitest';
import { pathToString, parsePath, parseJsonPointer, truncatePathMiddle } from './path';

describe('pathToString', () => {
	it('renders the root path as $', () => {
		expect(pathToString([])).toBe('$');
	});

	it('uses dot form for bare identifiers and brackets for indices', () => {
		expect(pathToString(['events', 42, 'ts'])).toBe('$.events[42].ts');
	});

	it('bracket-quotes non-identifier keys', () => {
		expect(pathToString(['weird-key'])).toBe('$["weird-key"]');
	});
});

describe('parsePath', () => {
	it('parses the root', () => {
		expect(parsePath('$')).toEqual({ ok: true, path: [] });
	});

	it('round-trips with pathToString', () => {
		const path = ['events', 42, 'ts'];
		expect(parsePath(pathToString(path))).toEqual({ ok: true, path });
	});

	it('parses bare leading keys and quoted keys', () => {
		expect(parsePath('events[4]["weird-key"]')).toEqual({
			ok: true,
			path: ['events', 4, 'weird-key'],
		});
	});

	it('reports an error for a non-numeric index', () => {
		expect(parsePath('$.a[x]').ok).toBe(false);
	});
});

describe('parseJsonPointer', () => {
	it('parses the empty pointer as the root path', () => {
		expect(parseJsonPointer('')).toEqual([]);
	});

	it('decodes ~1/~0 escapes and numeric tokens', () => {
		expect(parseJsonPointer('/a~1b/~0c')).toEqual(['a/b', '~c']);
		expect(parseJsonPointer('/events/4')).toEqual(['events', 4]);
	});
});

describe('truncatePathMiddle', () => {
	const long = '/Users/hendurhance/projects/pandia-ide/examples/compare/scattered-12-edits.a.json';

	it('returns paths within the budget unchanged', () => {
		expect(truncatePathMiddle('/tmp/a.json', 40)).toBe('/tmp/a.json');
		expect(truncatePathMiddle(long, Infinity)).toBe(long);
	});

	it('collapses middle directories and keeps the basename intact', () => {
		expect(truncatePathMiddle(long, 53)).toBe(
			'/Users/…/examples/compare/scattered-12-edits.a.json',
		);
	});

	it('keeps the basename when little else fits', () => {
		expect(truncatePathMiddle(long, 28)).toBe('/…/scattered-12-edits.a.json');
	});

	it('middle-truncates the stem, keeping its tail and the extension, when the name alone overflows', () => {
		expect(truncatePathMiddle(long, 20)).toBe('scatter…edits.a.json');
		expect(truncatePathMiddle(long, 15)).toBe('scat…its.a.json');
	});

	it('drops the extension but keeps the stem tail when the extension cannot fit', () => {
		expect(truncatePathMiddle(long, 6)).toBe('sc…s.a');
		expect(truncatePathMiddle(long, 4)).toBe('s….a');
	});

	it('handles backslash-separated paths', () => {
		expect(truncatePathMiddle('C:\\Users\\endurance\\Documents\\data\\big-export.json', 30)).toBe(
			'C:\\…\\data\\big-export.json',
		);
	});

	it('handles a bare filename with no directories', () => {
		expect(truncatePathMiddle('averyveryverylongname.json', 12)).toBe('ave…ame.json');
	});

	it('treats only the final dot segment as the extension', () => {
		expect(truncatePathMiddle('archive-of-everything-2024.tar.gz', 16)).toBe('archiv…24.tar.gz');
	});

	it('handles a leading-dot file', () => {
		expect(truncatePathMiddle('.eslintrc-workspace-overrides.json', 14)).toBe('.esl…ides.json');
		expect(truncatePathMiddle('.gitignore-global-defaults', 10)).toBe('.git…aults');
	});

	it('middle-cuts the whole name when the extension itself is the long part', () => {
		expect(truncatePathMiddle('data.backup-2024-01-15T120000', 12)).toBe('data.…120000');
	});

	it('handles a name with no extension', () => {
		expect(truncatePathMiddle('averyveryverylongname', 8)).toBe('ave…name');
	});

	it('degrades to an ellipsis at budget 1 and nothing at 0', () => {
		expect(truncatePathMiddle(long, 1)).toBe('…');
		expect(truncatePathMiddle(long, 0)).toBe('');
	});

	it('never exceeds the budget', () => {
		for (let budget = 1; budget <= long.length; budget++) {
			expect(truncatePathMiddle(long, budget).length).toBeLessThanOrEqual(budget);
		}
	});

	describe('sibling disambiguation', () => {
		const dir = '/Users/hendurhance/projects/pandia-ide/examples/compare/';
		const pairs: [string, string][] = [
			['scattered-12-edits.a.json', 'scattered-12-edits.b.json'],
			['config.prod.json', 'config.dev.json'],
			['report-2024-01-15.json', 'report-2024-01-16.json'],
			['users-snapshot-v1.json', 'users-snapshot-v2.json'],
		];
		const FLOOR = 2;

		it('renders each pair distinctly at every budget at or above the floor', () => {
			for (const [a, b] of pairs) {
				const pa = dir + a;
				const pb = dir + b;
				for (let budget = FLOOR; budget <= Math.max(pa.length, pb.length) + 2; budget++) {
					const ra = truncatePathMiddle(pa, budget);
					const rb = truncatePathMiddle(pb, budget);
					expect(ra).not.toBe(rb);
					expect(ra.length).toBeLessThanOrEqual(budget);
					expect(rb.length).toBeLessThanOrEqual(budget);
				}
			}
		});

		it('cannot distinguish below the floor', () => {
			for (const [a, b] of pairs) {
				expect(truncatePathMiddle(dir + a, 1)).toBe(truncatePathMiddle(dir + b, 1));
			}
		});
	});
});
