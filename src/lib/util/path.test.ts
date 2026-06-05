import { describe, it, expect } from 'vitest';
import { pathToString, parsePath, parseJsonPointer } from './path';

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
