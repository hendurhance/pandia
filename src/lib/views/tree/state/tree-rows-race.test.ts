import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import { rootRow } from '../logic/model';
import { TreeRowsController } from './tree-rows.svelte';
import type { NodeView, Path } from '$lib/ipc/bindings';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetSlice: vi.fn(), docSummary: vi.fn() } }));

let doc: Record<string, unknown>;
let gate: Promise<void> | null = null;
let childFetchStarted: () => void = () => {};

function childCount(v: unknown): number | null {
	if (Array.isArray(v)) return v.length;
	return kindOf(v) === 'object' ? Object.keys(v as object).length : null;
}

function shape(tree: TreeRowsController) {
	return tree.rows.map((r) => (r.variant === 'content' ? r.path.join('.') : r.variant));
}

beforeEach(() => {
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
			childCount: childCount(x),
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
