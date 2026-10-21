import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import { rootRow } from '../logic/model';
import { TreeRowsController } from './tree-rows.svelte';
import type { NodeView, Path } from '$lib/ipc/bindings';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetSlice: vi.fn() } }));

let doc: unknown;

function childCount(v: unknown): number | null {
	if (Array.isArray(v)) return v.length;
	return kindOf(v) === 'object' ? Object.keys(v as object).length : null;
}

function view(key: string | number, v: unknown): NodeView {
	return { key, kind: kindOf(v), preview: JSON.stringify(v), childCount: childCount(v) };
}

function setup(root: unknown) {
	doc = root;
	const tree = new TreeRowsController({
		handle: () => 'h' as never,
		summary: () => null,
		setError: vi.fn(),
	});
	tree.setRows([rootRow(kindOf(root), childCount(root))]);
	return tree;
}

function rowAt(tree: TreeRowsController, path: Path) {
	return tree.rows[tree.contentRowIdx(path)];
}

function shape(tree: TreeRowsController) {
	return tree.rows.map((r) => (r.variant === 'content' ? r.path.join('.') : r.variant));
}

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
	vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path, start, end) => {
		const v = path.reduce((node, seg) => (node as Record<string | number, unknown>)[seg], doc);
		const entries = Array.isArray(v)
			? v.map((x, i) => [i, x] as const)
			: Object.entries(v as object);
		return entries.slice(start, end).map(([k, x]) => view(k, x));
	});
});

describe('toggleAt', () => {
	it('keeps the exact count of a short container the backend could not count', async () => {
		const tree = setup([1, 2, 3]);
		tree.setRows([rootRow('array', null)]);
		await tree.toggleAt(0);
		expect(rowAt(tree, [])).toMatchObject({ expanded: true, childCount: 3 });
	});
});

describe('refetchAfterOp', () => {
	it('refreshes an edited array item beyond the first chunk', async () => {
		const list: unknown[] = Array.from({ length: 300 }, (_, i) => i);
		const tree = setup(list);
		await tree.ensurePathVisible([250]);
		list[250] = 'edited';
		await tree.refetchAfterOp([[250]]);
		expect(rowAt(tree, [250])).toMatchObject({ kind: 'string', preview: '"edited"' });
	});

	it('refreshes an edited object key beyond the first chunk', async () => {
		const obj: Record<string, unknown> = Object.fromEntries(
			Array.from({ length: 300 }, (_, i) => [`k${i}`, i]),
		);
		const tree = setup(obj);
		await tree.ensurePathVisible(['k250']);
		obj.k250 = 'edited';
		await tree.refetchAfterOp([['k250']]);
		expect(rowAt(tree, ['k250'])).toMatchObject({ kind: 'string', preview: '"edited"' });
	});

	it('drops the child rows of an expanded object converted to a scalar', async () => {
		const root: Record<string, unknown> = { obj: { a: 1, b: 2 } };
		const tree = setup(root);
		await tree.ensurePathVisible(['obj', 'a']);
		expect(shape(tree)).toEqual(['', 'obj', 'obj.a', 'obj.b', 'close', 'close']);
		root.obj = 'text';
		await tree.refetchAfterOp([['obj']]);
		expect(shape(tree)).toEqual(['', 'obj', 'close']);
		expect(rowAt(tree, ['obj'])).toMatchObject({ kind: 'string', expanded: false });
	});
});
