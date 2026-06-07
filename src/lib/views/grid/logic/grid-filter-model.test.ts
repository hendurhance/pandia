import { describe, it, expect } from 'vitest';
import {
	sameVal,
	colActive,
	compileFilters,
	compileGroups,
	valLabel,
	chipSummary,
	type ColFilter,
} from './grid-filter-model';

describe('sameVal', () => {
	it('compares primitives and small structures structurally', () => {
		expect(sameVal(1, 1)).toBe(true);
		expect(sameVal('a', 'a')).toBe(true);
		expect(sameVal(1, '1')).toBe(false);
		expect(sameVal({ a: 1 }, { a: 1 })).toBe(true);
	});
});

describe('colActive', () => {
	it('is false for an empty filter and whitespace-only text', () => {
		expect(colActive({})).toBe(false);
		expect(colActive({ text: '   ' })).toBe(false);
	});
	it('is true when any constraint is set', () => {
		expect(colActive({ values: ['x'] })).toBe(true);
		expect(colActive({ min: '5' })).toBe(true);
		expect(colActive({ presence: 'empty' })).toBe(true);
	});
});

describe('compileFilters', () => {
	const compile = (key: string, c: ColFilter) => compileFilters(new Map([[key, c]]));

	it('maps is/isNot value checklists to in/notIn', () => {
		expect(compile('a', { op: 'is', values: [1, 2] })).toEqual([
			{ key: 'a', op: 'in', value: [1, 2] },
		]);
		expect(compile('a', { op: 'isNot', values: [1] })).toEqual([
			{ key: 'a', op: 'notIn', value: [1] },
		]);
	});

	it('maps is/isNot text to eq/ne and trims', () => {
		expect(compile('a', { op: 'is', text: ' hi ' })).toEqual([{ key: 'a', op: 'eq', value: 'hi' }]);
		expect(compile('a', { op: 'isNot', text: 'x' })).toEqual([{ key: 'a', op: 'ne', value: 'x' }]);
	});

	it('maps contains / startsWith', () => {
		expect(compile('a', { op: 'contains', text: 'x' })).toEqual([
			{ key: 'a', op: 'contains', value: 'x' },
		]);
		expect(compile('a', { op: 'startsWith', text: 'x' })).toEqual([
			{ key: 'a', op: 'startsWith', value: 'x' },
		]);
	});

	it('maps numeric range to gte/lte (coerced to numbers) and presence to isEmpty/isNotEmpty', () => {
		expect(compile('a', { min: '5', max: '10' })).toEqual([
			{ key: 'a', op: 'gte', value: 5 },
			{ key: 'a', op: 'lte', value: 10 },
		]);
		expect(compile('a', { presence: 'empty' })).toEqual([{ key: 'a', op: 'isEmpty' }]);
		expect(compile('a', { presence: 'notEmpty' })).toEqual([{ key: 'a', op: 'isNotEmpty' }]);
	});

	it('returns an empty list for no filters', () => {
		expect(compileFilters(new Map())).toEqual([]);
	});
});

describe('compileGroups', () => {
	const grp = (key: string, c: ColFilter) => new Map([[key, c]]);

	it('compiles each group to an AND-list and ORs them (DNF)', () => {
		const groups = [grp('role', { op: 'is', text: 'admin' }), grp('signup', { max: '2023' })];
		expect(compileGroups(groups)).toEqual([
			[{ key: 'role', op: 'eq', value: 'admin' }],
			[{ key: 'signup', op: 'lte', value: 2023 }],
		]);
	});

	it('drops empty groups, so an all-empty list yields no structured filter', () => {
		expect(compileGroups([new Map(), new Map()])).toEqual([]);
		expect(compileGroups([grp('a', { op: 'is', text: 'x' }), new Map()])).toEqual([
			[{ key: 'a', op: 'eq', value: 'x' }],
		]);
	});
});

describe('valLabel', () => {
	it('labels empties, bools, and nested shapes', () => {
		expect(valLabel(null)).toBe('(empty)');
		expect(valLabel('')).toBe('(empty)');
		expect(valLabel('hi')).toBe('hi');
		expect(valLabel(true)).toBe('true');
		expect(valLabel([1, 2, 3])).toBe('[3]');
		expect(valLabel({ a: 1 })).toBe('{…}');
		expect(valLabel(42)).toBe('42');
	});
});

describe('chipSummary', () => {
	it('inlines up to two values, summarizes more', () => {
		expect(chipSummary({ op: 'is', values: ['a', 'b'] })).toBe('is a, b');
		expect(chipSummary({ op: 'is', values: [1, 2, 3] })).toBe('is 3 of');
		expect(chipSummary({ op: 'isNot', values: ['x'] })).toBe('is not x');
	});
	it('describes text, range, and presence facets', () => {
		expect(chipSummary({ op: 'contains', text: 'foo' })).toBe('contains "foo"');
		expect(chipSummary({ min: '1', max: '9' })).toBe('1–9');
		expect(chipSummary({ presence: 'empty' })).toBe('is empty');
	});
});
