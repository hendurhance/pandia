import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import { rootRow } from '../logic/model';
import { TreeRowsController } from './tree-rows.svelte';
import type { NodeKind, NodeView, Path, Summary } from '$lib/ipc/bindings';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docGetSlice: vi.fn(),
		docSummary: vi.fn(),
		docGetValue: vi.fn(),
	}),
}));

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

function expanded(tree: TreeRowsController) {
	return tree.rows.flatMap((r) => (r.variant === 'content' && r.expanded ? [r.path] : []));
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
	vi.mocked(ipc.docSummary).mockImplementation(
		async () => ({ rootKind: kindOf(doc), rootChildCount: childCount(doc) }) as Summary,
	);
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

	it('shows the new value of an edited scalar root, keeping number tokens exact', async () => {
		const cases: [NodeKind, string, string][] = [
			['string', '"he said \\"hi\\""', '"he said "hi""'],
			['number', '12345678901234567890.10', '12345678901234567890.10'],
			['bool', 'true', 'true'],
			['null', 'null', 'null'],
			['string', JSON.stringify('😀'.repeat(1001)), `"${'😀'.repeat(1000)}…"`],
		];
		for (const [kind, text, preview] of cases) {
			const tree = setup(null);
			tree.setRows([rootRow(kind, null)]);
			vi.mocked(ipc.docSummary).mockResolvedValue({
				rootKind: kind,
				rootChildCount: null,
			} as Summary);
			vi.mocked(ipc.docGetValue).mockResolvedValue(text as never);
			await tree.refetchAfterOp([[]]);
			expect(tree.rows).toEqual([expect.objectContaining({ path: [], kind, preview })]);
		}
	});
});

describe('expanded items after an array insert, delete or move', () => {
	it('follow their items after a delete above, and the deleted item is dropped', async () => {
		const list: unknown[] = [{ a: {} }, { b: 1 }, { c: { x: 1 } }, { d: { y: 1 } }];
		const tree = setup(list);
		await tree.ensurePathVisible([2, 'c', 'x']);
		list.splice(0, 1);
		await tree.refetchAfterOp([[]], { kind: 'deleteItem', path: [], index: 0 });
		expect(expanded(tree)).toEqual([[], [1], [1, 'c']]);
		list.splice(1, 1);
		await tree.refetchAfterOp([[]], { kind: 'deleteItem', path: [], index: 1 });
		expect(expanded(tree)).toEqual([[]]);
	});

	it('follow their items after an insert or a duplicate', async () => {
		const list: unknown[] = [{ a: 1 }, { b: 1 }, { c: 1 }];
		const tree = setup(list);
		await tree.ensurePathVisible([0, 'a']);
		await tree.ensurePathVisible([1, 'b']);
		list.splice(1, 0, { n: 1 });
		await tree.refetchAfterOp([[]], {
			kind: 'insertItemText',
			path: [],
			index: 1,
			text: '{"n":1}',
		});
		expect(expanded(tree)).toEqual([[], [0], [2]]);
		list.splice(1, 0, { a: 1 });
		await tree.refetchAfterOp([[]], { kind: 'duplicateItem', path: [], index: 0 });
		expect(expanded(tree)).toEqual([[], [0], [3]]);
	});

	it('follow their items after a move down and a move up', async () => {
		const list: unknown[] = [{ a: 1 }, { b: 1 }, { c: 1 }, { d: 1 }];
		const tree = setup(list);
		await tree.ensurePathVisible([0, 'a']);
		await tree.ensurePathVisible([3, 'd']);
		list.splice(2, 0, ...list.splice(0, 1));
		await tree.refetchAfterOp([[]], { kind: 'moveItem', path: [], from: 0, to: 2 });
		expect(rowAt(tree, [2])).toMatchObject({ preview: '{"a":1}', expanded: true });
		expect(expanded(tree)).toEqual([[], [2], [3]]);
		list.splice(1, 0, ...list.splice(3, 1));
		await tree.refetchAfterOp([[]], { kind: 'moveItem', path: [], from: 3, to: 1 });
		expect(rowAt(tree, [1])).toMatchObject({ preview: '{"d":1}', expanded: true });
		expect(expanded(tree)).toEqual([[], [1], [3]]);
	});

	it('are dropped when the op is unknown, while keyed children stay open', async () => {
		const list: unknown[] = [{ a: 1 }, { b: 1 }, { c: 1 }];
		const tree = setup(list);
		await tree.ensurePathVisible([1, 'b']);
		list.splice(0, 1);
		await tree.refetchAfterOp([[]]);
		expect(expanded(tree)).toEqual([[]]);

		const keyed = setup({ o: { p: { q: 1 } } });
		await keyed.ensurePathVisible(['o', 'p', 'q']);
		await keyed.refetchAfterOp([['o']]);
		expect(expanded(keyed)).toEqual([[], ['o'], ['o', 'p']]);
	});
});
