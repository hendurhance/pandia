import { describe, expect, it } from 'vitest';
import { gapAt, siblingSlots } from './row-drag-math';
import type { ContentRow, PlaceholderRow, CloseRow, Row } from './model';
import type { NodeKind, Path } from '$lib/ipc/types';

function content(path: Path, depth: number, key: ContentRow['key'] = 'k'): ContentRow {
	return {
		variant: 'content',
		path,
		depth,
		key,
		kind: 'string' as NodeKind,
		preview: '',
		childCount: null,
		sizeHint: 0,
		expanded: false,
	};
}

function placeholder(parentPath: Path, depth: number, index: number): PlaceholderRow {
	return { variant: 'placeholder', parentPath, depth, index };
}

function close(parentPath: Path, depth: number): CloseRow {
	return { variant: 'close', depth, bracket: ']', parentPath };
}

describe('siblingSlots', () => {
	it('returns null for a depth-0 (root) row', () => {
		const rows: Row[] = [content([], 0)];
		expect(siblingSlots(rows, 0)).toBeNull();
	});

	it('returns null when the parent cannot be located (malformed flat list)', () => {
		const rows: Row[] = [content(['a'], 1), content(['b'], 1)];
		expect(siblingSlots(rows, 0)).toBeNull();
	});

	it('finds all sibling slots (content + placeholders) at the same depth', () => {
		const rows: Row[] = [
			content([], 0),
			content(['a'], 1),
			content(['b'], 1),
			placeholder([], 1, 2),
			content(['c'], 1),
			close([], 0),
		];
		const info = siblingSlots(rows, 1);
		expect(info).not.toBeNull();
		expect(info!.slots).toEqual([1, 2, 3, 4]);
		expect(info!.endIndex).toBe(5); // the close row
	});

	it('skips deeper-nested rows inside an expanded sibling', () => {
		const rows: Row[] = [
			content([], 0),
			content(['a'], 1),
			content(['a', 'x'], 2),
			content(['b'], 1),
			close([], 0),
		];
		const info = siblingSlots(rows, 1);
		expect(info!.slots).toEqual([1, 3]); // only depth-1 siblings
	});
});

describe('gapAt', () => {
	const rows: Row[] = [
		content([], 0), // 0 — root
		content(['a'], 1), // 1
		content(['b'], 1), // 2
		content(['c'], 1), // 3
		close([], 0), // 4 — parent close (the "after-last" boundary)
	];
	const offsets = [0, 22, 44, 66, 88, 110];

	it('snaps to gap 0 when the cursor is at the top of the first sibling', () => {
		const r = gapAt(rows, offsets, 1, 22);
		expect(r?.gap).toBe(0);
	});

	it('snaps to a middle gap by nearest top-of-slot distance', () => {
		const r = gapAt(rows, offsets, 1, 50); // closest to offsets[3]=66 or [2]=44 → 44
		expect(r?.gap).toBe(1); // gap between a and b sits at top of b (offset 44)
	});

	it('snaps to the trailing gap (after the last sibling) when below all slots', () => {
		const r = gapAt(rows, offsets, 1, 100); // closest to endIndex=4 → offset 88
		expect(r?.gap).toBe(3); // 3 siblings → gap 3 = after-last
		expect(r?.y).toBe(88);
	});

	it('returns null for a depth-0 row', () => {
		expect(gapAt(rows, offsets, 0, 50)).toBeNull();
	});
});

