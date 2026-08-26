import { describe, it, expect } from 'vitest';
import { highlightsForSide } from './highlights';
import type { DiffKind, Path } from '$lib/ipc/bindings';

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
