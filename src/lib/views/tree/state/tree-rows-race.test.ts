import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import { rootRow } from '../logic/model';
import { TreeRowsController } from './tree-rows.svelte';
import type { NodeView, Path } from '$lib/ipc/bindings';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docGetSlice: vi.fn(),
		docSummary: vi.fn(),
		docChildCount: vi.fn(),
	}),
}));

let doc: Record<string, unknown>;
let gate: Promise<void> | null = null;
let childFetchStarted: () => void = () => {};
let uncounted: string | null = null;

function childCount(v: unknown): number | null {
	if (Array.isArray(v)) return v.length;
	return kindOf(v) === 'object' ? Object.keys(v as object).length : null;
}

function shape(tree: TreeRowsController) {
	return tree.rows.map((r) => (r.variant === 'content' ? r.path.join('.') : r.variant));
}

function holdNextSlice() {
	const slice = vi.mocked(ipc.docGetSlice).getMockImplementation()!;
	let release!: () => void;
	let reach!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const reached = new Promise<void>((r) => (reach = r));
	vi.mocked(ipc.docGetSlice).mockImplementationOnce(async (...args) => {
		reach();
		await gate;
		return slice(...args);
	});
	return { reached, release };
}

beforeEach(() => {
	uncounted = null;
	vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
	vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path: Path, start, end) => {
		const v = path.reduce((n, seg) => (n as Record<string | number, unknown>)[seg], doc as unknown);
		const entries = Array.isArray(v)
			? v.map((x, i) => [i, x] as const)
			: Object.entries(v as object);
		const out: NodeView[] = entries.slice(start, end).map(([k, x]) => ({
			key: k,
			kind: kindOf(x),
			preview: JSON.stringify(x),
			childCount: k === uncounted ? null : childCount(x),
		}));
		if (path.length === 1 && gate) {
			childFetchStarted();
			await gate;
		}
		return out;
	});
});

describe('two reloads of the same container that overlap', () => {
	it('leave the tree showing the newest document', async () => {
		doc = { items: [0, 1, 2] };
		const tree = new TreeRowsController({
			handle: () => 'h' as never,
			summary: () => null,
			setError: vi.fn(),
		});
		tree.setRows([rootRow('object', 1)]);
		await tree.ensurePathVisible(['items', 0]);
		expect(shape(tree)).toEqual(['', 'items', 'items.0', 'items.1', 'items.2', 'close', 'close']);

		doc = { items: [0, 1] };
		let release!: () => void;
		gate = new Promise<void>((r) => (release = r));
		const started = new Promise<void>((r) => (childFetchStarted = r));
		const first = tree.refetchAfterOp([['items']]);
		await started;
		gate = null;

		doc = { items: [0] };
		const second = tree.refetchAfterOp([['items']]);
		await Promise.race([second, new Promise((r) => setTimeout(r, 20))]);
		release();
		await Promise.all([first, second]);

		expect(shape(tree)).toEqual(['', 'items', 'items.0', 'close', 'close']);
	});
});

describe('rows above shift while a toggle or refresh is waiting', () => {
	async function setup(root: Record<string, unknown>) {
		doc = root;
		const tree = new TreeRowsController({
			handle: () => 'h' as never,
			summary: () => null,
			setError: vi.fn(),
		});
		tree.setRows([rootRow('object', Object.keys(root).length)]);
		await tree.toggleAt(0);
		await tree.toggleAt(1);
		return tree;
	}

	it('still expands the clicked row when its children arrive', async () => {
		const tree = await setup({ small: [1, 2], big: [3] });
		const held = holdNextSlice();
		const expanding = tree.toggleAt(tree.contentRowIdx(['big']));
		await held.reached;
		await tree.toggleAt(1);
		held.release();
		await expanding;
		expect(shape(tree)).toEqual(['', 'small', 'big', 'big.0', 'close', 'close']);
	});

	it('inserts the children under the clicked row after a slow child count', async () => {
		uncounted = 'big';
		const tree = await setup({ small: [1, 2], big: Array.from({ length: 300 }, (_, i) => i) });
		let release: ((n: number) => void) | undefined;
		vi.mocked(ipc.docChildCount).mockImplementationOnce(
			() => new Promise((r) => (release = r)) as never,
		);
		const expanding = tree.toggleAt(tree.contentRowIdx(['big']));
		await vi.waitFor(() => expect(release).toBeDefined());
		await tree.toggleAt(1);
		release!(300);
		await expanding;
		const items = Array.from({ length: 200 }, (_, i) => `big.${i}`);
		expect(shape(tree)).toEqual(['', 'small', 'big', ...items, 'vgap', 'close', 'close']);
		expect(tree.rows[2]).toMatchObject({ expanded: true, childCount: 300 });
	});

	it('writes the refreshed row where that row is now', async () => {
		const root: Record<string, unknown> = { small: [1, 2], k: 1, z: 9 };
		const tree = await setup(root);
		root.k = 2;
		const held = holdNextSlice();
		const refreshing = tree.refetchAfterOp([['k']]);
		await held.reached;
		await tree.toggleAt(1);
		held.release();
		await refreshing;
		expect(shape(tree)).toEqual(['', 'small', 'k', 'z', 'close']);
		expect(tree.rows[2]).toMatchObject({ path: ['k'], preview: '2' });
	});
});
