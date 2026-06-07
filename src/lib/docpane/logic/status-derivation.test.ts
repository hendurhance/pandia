import { describe, expect, it } from 'vitest';
import { kindAtSelection, validityFromView } from './status-derivation';
import type { ContentRow, Row } from '../../views/tree/logic/model';
import type { NodeKind, Path } from '../../ipc/types';

function content(path: Path, kind: NodeKind): ContentRow {
	return {
		variant: 'content',
		path,
		depth: path.length,
		key: path[path.length - 1] ?? '',
		kind,
		preview: '',
		childCount: null,
		sizeHint: 0,
		expanded: false,
	};
}

describe('validityFromView', () => {
	const okSchema = { valid: true, errorCount: 0 };
	const badSchema = { valid: false, errorCount: 3 };
	const okParse = { valid: true, message: null };
	const badParse = { valid: false, message: 'Unexpected token } at line 3' };

	it('code view + parse state → buffer (parse takes priority)', () => {
		expect(
			validityFromView({ viewMode: 'code', codeValid: okParse, schemaResult: okSchema }),
		).toEqual({ kind: 'buffer', ok: true, detail: undefined });

		expect(
			validityFromView({ viewMode: 'code', codeValid: badParse, schemaResult: okSchema }),
		).toEqual({
			kind: 'buffer',
			ok: false,
			detail: 'Unexpected token } at line 3',
		});
	});

	it('non-code view → schema even if codeValid happens to be set', () => {
		expect(
			validityFromView({ viewMode: 'tree', codeValid: badParse, schemaResult: okSchema }),
		).toEqual({ kind: 'schema', ok: true, errors: 0 });

		expect(
			validityFromView({ viewMode: 'grid', codeValid: badParse, schemaResult: badSchema }),
		).toEqual({ kind: 'schema', ok: false, errors: 3 });
	});

	it('code view without parse state falls through to schema', () => {
		expect(validityFromView({ viewMode: 'code', codeValid: null, schemaResult: okSchema })).toEqual(
			{ kind: 'schema', ok: true, errors: 0 },
		);
	});

	it('returns null when nothing is loaded', () => {
		expect(validityFromView({ viewMode: 'tree', codeValid: null, schemaResult: null })).toBeNull();
		expect(validityFromView({ viewMode: 'graph', codeValid: null, schemaResult: null })).toBeNull();
	});

	it('strips message when undefined for the buffer kind', () => {
		const r = validityFromView({
			viewMode: 'code',
			codeValid: { valid: true, message: null },
			schemaResult: null,
		});
		expect(r).toEqual({ kind: 'buffer', ok: true, detail: undefined });
	});
});

describe('kindAtSelection', () => {
	const rows: Row[] = [
		content([], 'object'),
		content(['users'], 'array'),
		content(['users', 0], 'object'),
		content(['users', 0, 'name'], 'string'),
		content(['count'], 'number'),
	];

	const findIdx = (path: Path) =>
		rows.findIndex(
			(r) =>
				r.variant === 'content' &&
				r.path.length === path.length &&
				r.path.every((seg, i) => seg === path[i]),
		);

	it('returns rootKind when selection is null (no selection)', () => {
		expect(kindAtSelection(rows, findIdx, null, 'object')).toBe('object');
	});

	it('returns rootKind for the root path', () => {
		expect(kindAtSelection(rows, findIdx, [], 'object')).toBe('object');
		expect(kindAtSelection(rows, findIdx, [], 'array')).toBe('array');
	});

	it('walks the loaded rows to find the selected node kind', () => {
		expect(kindAtSelection(rows, findIdx, ['users'], 'object')).toBe('array');
		expect(kindAtSelection(rows, findIdx, ['users', 0], 'object')).toBe('object');
		expect(kindAtSelection(rows, findIdx, ['users', 0, 'name'], 'object')).toBe('string');
		expect(kindAtSelection(rows, findIdx, ['count'], 'object')).toBe('number');
	});

	it('returns null when the path is not currently loaded', () => {
		expect(kindAtSelection(rows, findIdx, ['missing'], 'object')).toBeNull();
		expect(kindAtSelection(rows, findIdx, ['users', 99], 'object')).toBeNull();
	});
});
