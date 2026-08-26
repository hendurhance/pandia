import { describe, it, expect, vi, beforeEach } from 'vitest';
import { valueCommitOp, DocEditController } from './doc-edit.svelte';
import { ipc } from '$lib/ipc/client';
import { asLosslessText } from '$lib/ipc/wire';
import type { ContentRow, Row } from '$lib/views/tree/logic/model';
import type { Op } from '$lib/ipc/bindings';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetValue: vi.fn() } }));

const PI = '3.14159265358979323846264338327950288419716939937510582097494';

describe('valueCommitOp', () => {
	it('commits a number edit as a raw-text op, exactly as typed', () => {
		expect(valueCommitOp('number', ['a'], '1', PI)).toEqual({
			op: { kind: 'setValueText', path: ['a'], text: PI },
		});
	});

	it('an untouched buffer commits nothing (blur must not rewrite the token)', () => {
		expect(valueCommitOp('number', ['a'], '9007199254740993', '9007199254740993')).toBeNull();
		expect(valueCommitOp('number', ['a'], '1e309', '1e309')).toBeNull();
	});

	it('rejects invalid syntax without producing an op', () => {
		const r = valueCommitOp('number', ['a'], '1', 'not-json');
		expect(r !== null && 'error' in r).toBe(true);
	});

	it('bool and null edits also travel as text', () => {
		expect(valueCommitOp('bool', ['a'], 'true', 'false')).toEqual({
			op: { kind: 'setValueText', path: ['a'], text: 'false' },
		});
		expect(valueCommitOp('null', ['a'], 'null', '12345678901234567890')).toEqual({
			op: { kind: 'setValueText', path: ['a'], text: '12345678901234567890' },
		});
	});

	it('string edits travel as JSON-quoted text', () => {
		expect(valueCommitOp('string', ['a'], '"x"', 'hello')).toEqual({
			op: { kind: 'setValueText', path: ['a'], text: '"hello"' },
		});
	});
});

describe('DocEditController truncated-string open', () => {
	const FULL = 'x'.repeat(5000);
	const TRUNCATED_PREVIEW = `"${'x'.repeat(1000)}\u{2026}"`;

	function stringRow(preview: string): ContentRow {
		return {
			variant: 'content',
			path: ['a'],
			depth: 1,
			key: 'a',
			kind: 'string',
			preview,
			childCount: null,
			expanded: false,
		};
	}

	function setup(preview: string, handle: string | null = 'h') {
		const applied: Op[] = [];
		const errors: (string | null)[] = [];
		const rows: Row[] = [stringRow(preview)];
		const ctrl = new DocEditController({
			rows: () => rows,
			handle: () => handle,
			apply: async (op) => {
				applied.push(op);
				return null;
			},
			setError: (msg) => errors.push(msg),
		});
		return { ctrl, applied, errors, rows };
	}

	beforeEach(() => {
		vi.mocked(ipc.docGetValue).mockReset();
	});

	it('a failed full-value fetch refuses to open and never commits a shorter value', async () => {
		vi.mocked(ipc.docGetValue).mockRejectedValue(new Error('ipc down'));
		const { ctrl, applied, errors } = setup(TRUNCATED_PREVIEW);

		await ctrl.startValue(0);
		expect(ctrl.state).toBeNull();
		expect(errors.at(-1)).toBeTruthy();

		await ctrl.commit();
		expect(applied).toEqual([]);
	});

	it('a successful fetch seeds the editor with the full value, not the preview', async () => {
		// The wire carries the value as its exact JSON text; the controller decodes.
		vi.mocked(ipc.docGetValue).mockResolvedValue(asLosslessText(JSON.stringify(FULL)));
		const { ctrl, applied } = setup(TRUNCATED_PREVIEW);

		await ctrl.startValue(0);
		expect(ctrl.state?.buffer).toBe(FULL);

		await ctrl.commit();
		expect(applied).toEqual([{ kind: 'setValueText', path: ['a'], text: JSON.stringify(FULL) }]);
	});

	it('no handle means no editor for a truncated preview', async () => {
		const { ctrl } = setup(TRUNCATED_PREVIEW, null);
		await ctrl.startValue(0);
		expect(ctrl.state).toBeNull();
		expect(vi.mocked(ipc.docGetValue)).not.toHaveBeenCalled();
	});

	it('a short string opens straight from the preview without fetching', async () => {
		const { ctrl } = setup('"hello"');
		await ctrl.startValue(0);
		expect(ctrl.state?.buffer).toBe('hello');
		expect(vi.mocked(ipc.docGetValue)).not.toHaveBeenCalled();
	});
});
