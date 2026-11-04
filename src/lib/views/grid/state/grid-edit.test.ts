import { describe, it, expect, vi } from 'vitest';
import { LosslessNumber } from 'lossless-json';
import type { Op, Path } from '$lib/ipc/bindings';
import { GridEditController } from './grid-edit.svelte';
import { MISSING } from '../logic/grid-cell';

type Row = { index: number; value: unknown };

function setup(rows: Row[], arrayPath: Path = ['users']) {
	const applied: Op[] = [];
	const openInTree = vi.fn();
	const errors: (string | null)[] = [];
	const edit = new GridEditController({
		path: () => arrayPath,
		getRow: (rowIdx) => rows[rowIdx],
		apply: async (op) => {
			applied.push(op);
			return true;
		},
		openInTree,
		setError: (e) => errors.push(e),
	});
	return { edit, applied, openInTree, errors };
}

const ROWS: Row[] = [
	{ index: 0, value: { name: 'Ada', age: new LosslessNumber('12345678901234567890'), on: true } },
	{ index: 4, value: { name: 'Lin', tags: ['x'], note: 'a\nb', gone: null } },
];

describe('GridEditController', () => {
	it('edits a string as plain text and writes it as a JSON string', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(0, 'name', 'Ada');
		expect(edit.state?.buffer).toBe('Ada');
		edit.input('Ada "Countess"');
		expect(await edit.commit()).toBe(true);
		expect(applied).toEqual([
			{ kind: 'setValueText', path: ['users', 0, 'name'], text: '"Ada \\"Countess\\""' },
		]);
		expect(edit.state).toBeNull();
	});

	it('starts a number with its exact digits and keeps them on commit', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(0, 'age', new LosslessNumber('12345678901234567890'));
		expect(edit.state?.buffer).toBe('12345678901234567890');
		edit.input('12345678901234567891');
		await edit.commit();
		expect(applied).toEqual([
			{ kind: 'setValueText', path: ['users', 0, 'age'], text: '12345678901234567891' },
		]);
	});

	it('keeps invalid input in the editor with the reason, like the Tree', async () => {
		const { edit, applied, errors } = setup(ROWS);
		edit.start(0, 'on', true);
		edit.input('yes');
		expect(await edit.commit()).toBe(false);
		expect(applied).toEqual([]);
		expect(edit.state?.buffer).toBe('yes');
		expect(errors.at(-1)).toContain('invalid bool');
	});

	it('addresses the row by its index in the document, not its place on screen', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(1, 'gone', null);
		expect(edit.state?.buffer).toBe('null');
		edit.input('7');
		await edit.commit();
		expect(applied[0]).toEqual({ kind: 'setValueText', path: ['users', 4, 'gone'], text: '7' });
	});

	it('adds a missing key, reading valid JSON as typed and anything else as text', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(1, 'age', MISSING);
		expect(edit.state?.buffer).toBe('');
		edit.input('42');
		await edit.commit();
		edit.start(1, 'email', MISSING);
		edit.input('lin@x.dev');
		await edit.commit();
		expect(applied).toEqual([
			{ kind: 'insertKeyText', path: ['users', 4], key: 'age', text: '42', position: null },
			{
				kind: 'insertKeyText',
				path: ['users', 4],
				key: 'email',
				text: '"lin@x.dev"',
				position: null,
			},
		]);
	});

	it('leaves a missing key alone when nothing was typed', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(1, 'age', MISSING);
		expect(await edit.commit()).toBe(true);
		expect(applied).toEqual([]);
	});

	it('opens objects, arrays and multi-line strings in the Tree instead', () => {
		const { edit, openInTree } = setup(ROWS);
		edit.start(1, 'tags', ['x']);
		edit.start(1, 'note', 'a\nb');
		expect(edit.state).toBeNull();
		expect(openInTree.mock.calls).toEqual([[['users', 4, 'tags']], [['users', 4, 'note']]]);
	});

	it('cannot add a key to a row that is not an object', () => {
		const { edit, errors } = setup([{ index: 2, value: 5 }]);
		edit.start(0, 'name', MISSING);
		expect(edit.state).toBeNull();
		expect(errors.at(-1)).toContain('[2] is a number');
	});

	it('cancel closes the editor without writing', async () => {
		const { edit, applied } = setup(ROWS);
		edit.start(0, 'name', 'Ada');
		edit.input('Bob');
		edit.cancel();
		expect(edit.state).toBeNull();
		expect(await edit.commit()).toBe(true);
		expect(applied).toEqual([]);
	});
});
