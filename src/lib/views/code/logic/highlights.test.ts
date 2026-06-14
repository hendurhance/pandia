import { describe, it, expect } from 'vitest';
import { stringifyWithOffsets, lookupOffsets, highlightsForSide } from './highlights';
import type { DiffKind, Path } from '$lib/ipc/types';

const at = (offsets: Map<string, [number, number]>, path: Path) =>
	offsets.get(JSON.stringify(path));

describe('stringifyWithOffsets', () => {
	it('pretty-prints with a 2-space indent', () => {
		expect(stringifyWithOffsets({ a: 1, b: [2, 3] }).text).toBe(
			'{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
		);
	});
	it('collapses empty containers', () => {
		expect(stringifyWithOffsets({}).text).toBe('{}');
		expect(stringifyWithOffsets([]).text).toBe('[]');
	});
	it('maps each path to the exact [start,end) slice of its value', () => {
		const { text, offsets } = stringifyWithOffsets({ x: { y: [true, null, 'hi'] } });
		expect(text.slice(...at(offsets, ['x', 'y', 0])!)).toBe('true');
		expect(text.slice(...at(offsets, ['x', 'y', 1])!)).toBe('null');
		expect(text.slice(...at(offsets, ['x', 'y', 2])!)).toBe('"hi"');
		expect(text.slice(...at(offsets, ['x', 'y'])!)).toBe(
			'[\n      true,\n      null,\n      "hi"\n    ]',
		);
	});
	it('maps the root path to the entire document', () => {
		const { text, offsets } = stringifyWithOffsets({ a: 1 });
		expect(text.slice(...at(offsets, [])!)).toBe(text);
	});
});

describe('lookupOffsets', () => {
	it('returns the span for a known path and null for a missing one', () => {
		const { offsets } = stringifyWithOffsets({ a: 1 });
		expect(lookupOffsets(offsets, ['a'])).not.toBeNull();
		expect(lookupOffsets(offsets, ['nope'])).toBeNull();
	});
});

describe('highlightsForSide', () => {
	const entries: Array<{ path: Path; kind: DiffKind }> = [
		{ path: ['a'], kind: 'removed' },
		{ path: ['b'], kind: 'added' },
		{ path: ['c'], kind: 'changed' },
		{ path: ['d'], kind: 'moved' },
	];
	it('keeps removed + changed on the left', () => {
		expect(highlightsForSide(entries, 'left').map((h) => h.path)).toEqual([['a'], ['c']]);
	});
	it('keeps added + changed on the right', () => {
		expect(highlightsForSide(entries, 'right').map((h) => h.path)).toEqual([['b'], ['c']]);
	});
});
