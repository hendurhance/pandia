import { describe, expect, it } from 'vitest';
import { computeInvalidMarks } from './invalid-marks';
import { pathKey } from '../../views/tree/logic/model';
import type { ContentRow, Row } from '../../views/tree/logic/model';
import type { NodeKind, Path } from '$lib/ipc/bindings';

function content(path: Path, kind: NodeKind = 'object'): ContentRow {
	return {
		variant: 'content',
		path,
		depth: path.length,
		key: path[path.length - 1] ?? '',
		kind,
		preview: '',
		childCount: null,
		expanded: true,
	};
}

describe('computeInvalidMarks', () => {
	it('returns empty when result is null', () => {
		const m = computeInvalidMarks({
			result: null,
			stale: false,
			rows: [],
		});
		expect(m.size).toBe(0);
	});

	it('returns empty when result is valid', () => {
		const m = computeInvalidMarks({
			result: { valid: true, errors: [] },
			stale: false,
			rows: [],
		});
		expect(m.size).toBe(0);
	});

	it('returns empty when there are no errors', () => {
		const m = computeInvalidMarks({
			result: { valid: false, errors: [] },
			stale: false,
			rows: [],
		});
		expect(m.size).toBe(0);
	});

	it('marks the exact error path + every ancestor', () => {
		const rows: Row[] = [
			content([], 'object'),
			content(['a'], 'object'),
			content(['a', 'b'], 'object'),
			content(['a', 'b', 'c'], 'string'),
		];
		const m = computeInvalidMarks({
			result: { valid: false, errors: [{ instancePath: '/a/b/c' }] },
			stale: false,
			rows,
		});
		expect(m.get(pathKey(['a', 'b', 'c']))).toBe('error');
		expect(m.get(pathKey(['a', 'b']))).toBe('ancestor');
		expect(m.get(pathKey(['a']))).toBe('ancestor');
		expect(m.get(pathKey([]))).toBe('ancestor');
	});

	it('an ancestor that is also an error stays an error (does not downgrade)', () => {
		const rows: Row[] = [
			content([], 'object'),
			content(['a'], 'object'),
			content(['a', 'b'], 'string'),
		];
		const m = computeInvalidMarks({
			result: {
				valid: false,
				errors: [{ instancePath: '/a' }, { instancePath: '/a/b' }],
			},
			stale: false,
			rows,
		});
		expect(m.get(pathKey(['a']))).toBe('error');
		expect(m.get(pathKey(['a', 'b']))).toBe('error');
		expect(m.get(pathKey([]))).toBe('ancestor');
	});

	it('dims the marks while the verdict is out of date', () => {
		const rows: Row[] = [content([], 'object'), content(['x'], 'string')];
		const m = computeInvalidMarks({
			result: { valid: false, errors: [{ instancePath: '/x' }] },
			stale: true,
			rows,
		});
		expect(m.get(pathKey(['x']))).toBe('stale-error');
		expect(m.get(pathKey([]))).toBe('stale-ancestor');
	});

	it('keeps full marks while the verdict is current', () => {
		const rows: Row[] = [content([], 'object'), content(['x'], 'string')];
		const m = computeInvalidMarks({
			result: { valid: false, errors: [{ instancePath: '/x' }] },
			stale: false,
			rows,
		});
		expect(m.get(pathKey(['x']))).toBe('error');
		expect(m.get(pathKey([]))).toBe('ancestor');
	});

	it('uses row kinds to resolve digit-keyed object paths', () => {
		const rows: Row[] = [
			content([], 'object'),
			content(['data'], 'object'), // <-- the all-digit-keys live HERE
			content(['data', '0'], 'string'),
		];
		const m = computeInvalidMarks({
			result: { valid: false, errors: [{ instancePath: '/data/0' }] },
			stale: false,
			rows,
		});
		const marked = Array.from(m.entries()).filter(([_, kind]) => kind === 'error');
		expect(marked.length).toBe(1);
		expect(m.has(pathKey(['data', '0']))).toBe(true);
	});
});
