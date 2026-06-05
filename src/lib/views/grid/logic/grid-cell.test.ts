import { describe, it, expect } from 'vitest';
import {
	UNLOADED,
	MISSING,
	valueKind,
	cellText,
	isAlignRight,
	cellClass,
	cellRender,
	cellTitle,
	inspectorText,
} from './grid-cell';

describe('valueKind', () => {
	it('maps JS values to NodeKind', () => {
		expect(valueKind(null)).toBe('null');
		expect(valueKind(true)).toBe('bool');
		expect(valueKind(42)).toBe('number');
		expect(valueKind('x')).toBe('string');
		expect(valueKind([1, 2])).toBe('array');
		expect(valueKind({ a: 1 })).toBe('object');
	});
});

describe('cellText', () => {
	it('renders scalars as bare values', () => {
		expect(cellText(null)).toBe('—');
		expect(cellText(true)).toBe('true');
		expect(cellText(false)).toBe('false');
		expect(cellText(42)).toBe('42');
		expect(cellText('hi')).toBe('hi');
	});
	it('summarizes containers', () => {
		expect(cellText([])).toBe('[]');
		expect(cellText([1, 2, 3])).toBe('[3 items]');
		expect(cellText({})).toBe('{}');
		expect(cellText({ a: 1, b: 2 })).toBe('{2 keys}');
	});
	it('truncates long strings at 500 chars', () => {
		const out = cellText('a'.repeat(600));
		expect(out.length).toBe(501);
		expect(out.endsWith('…')).toBe(true);
	});
});

describe('isAlignRight', () => {
	it('right-aligns only numbers', () => {
		expect(isAlignRight('number')).toBe(true);
		expect(isAlignRight('string')).toBe(false);
	});
});

describe('cellClass', () => {
	it('flags sentinels and right-aligns numbers', () => {
		expect(cellClass(UNLOADED)).toBe('cell unloaded');
		expect(cellClass(MISSING)).toBe('cell missing');
		expect(cellClass(42)).toBe('cell number right');
		expect(cellClass('x')).toBe('cell string');
		expect(cellClass(null)).toBe('cell null');
	});
});

describe('cellRender', () => {
	it('shows ellipsis while loading and blanks missing', () => {
		expect(cellRender(UNLOADED)).toBe('…');
		expect(cellRender(MISSING)).toBe('');
		expect(cellRender(42)).toBe('42');
	});
});

describe('cellTitle', () => {
	it('returns undefined for sentinels, full text otherwise', () => {
		expect(cellTitle(UNLOADED)).toBeUndefined();
		expect(cellTitle(MISSING)).toBeUndefined();
		expect(cellTitle('long string')).toBe('long string');
		expect(cellTitle(null)).toBe('null');
		expect(cellTitle({ a: 1 })).toBe('{"a":1}');
		expect(cellTitle(42)).toBe('42');
	});
});

describe('inspectorText', () => {
	it('pretty-prints objects and labels sentinels', () => {
		expect(inspectorText(UNLOADED)).toBe('loading…');
		expect(inspectorText(MISSING)).toBe('(no value)');
		expect(inspectorText('x')).toBe('x');
		expect(inspectorText(null)).toBe('null');
		expect(inspectorText({ a: 1 })).toBe('{\n  "a": 1\n}');
		expect(inspectorText(42)).toBe('42');
	});
});
