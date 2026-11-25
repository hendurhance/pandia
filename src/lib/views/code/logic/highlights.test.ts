import { describe, it, expect } from 'vitest';
import { diffKindsForSide, highlightsForSide } from './highlights';
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

describe('diffKindsForSide', () => {
	const entries = [
		{ path: ['a'], kind: 'added' as const },
		{ path: ['b'], kind: 'removed' as const },
		{ path: ['c'], kind: 'changed' as const },
		{ path: ['d2'], leftPath: ['d1'], kind: 'moved' as const },
	];

	it('keys the left side by the old path and skips additions', () => {
		expect([...diffKindsForSide(entries, 'left')]).toEqual([
			['["b"]', 'removed'],
			['["c"]', 'changed'],
			['["d1"]', 'moved'],
		]);
	});

	it('keys the right side by the new path and skips removals', () => {
		expect([...diffKindsForSide(entries, 'right')]).toEqual([
			['["a"]', 'added'],
			['["c"]', 'changed'],
			['["d2"]', 'moved'],
		]);
	});
});
