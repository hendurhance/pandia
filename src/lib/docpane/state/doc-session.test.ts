import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { DocSessionController, type DocSessionDeps } from './doc-session.svelte';
import type { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import type { FindController } from '$lib/find/state/find.svelte';
import type { CompareController } from '$lib/views/compare/state/compare.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docApplyOp: vi.fn(),
		docSetRootText: vi.fn(),
		docUndo: vi.fn(),
		docRedo: vi.fn(),
		docSummary: vi.fn(),
	},
}));

const RESULT = { version: 2, affectedPaths: [['a']] };

function setup(findOpen: boolean) {
	const calls: string[] = [];
	vi.mocked(ipc.docSummary).mockImplementation(async () => {
		calls.push('summary');
		return { version: 2 } as never;
	});
	const tree = {
		refetchAfterOp: vi.fn(async () => {
			calls.push('refetch');
		}),
		setRows: vi.fn(),
		toggleAt: vi.fn(),
	} as unknown as TreeRowsController;
	const find = {
		open: findOpen,
		query: 'needle',
		runSearch: vi.fn(async () => {
			calls.push('find');
		}),
		reset: vi.fn(),
	} as unknown as FindController;
	const compare = {
		release: vi.fn(async () => {}),
		clear: vi.fn(),
	} as unknown as CompareController;
	const deps: DocSessionDeps = {
		tree,
		find,
		compare,
		setBusy: () => {},
		setError: vi.fn(),
		getError: () => null,
		setSelectedPath: () => {},
		clearViewState: () => {},
		flushPendingEdits: async () => true,
		applyDefaultView: async () => {},
		flash: () => {},
		cancelBackupTimer: () => {},
	};
	const session = new DocSessionController(deps);
	session.handle = 'h' as never;
	return { session, calls, find, deps };
}

describe('DocSessionController — the post-mutation protocol', () => {
	beforeEach(() => {
		vi.mocked(ipc.docApplyOp)
			.mockReset()
			.mockResolvedValue(RESULT as never);
		vi.mocked(ipc.docUndo)
			.mockReset()
			.mockResolvedValue(RESULT as never);
		vi.mocked(ipc.docRedo)
			.mockReset()
			.mockResolvedValue(RESULT as never);
	});

	it('applyOp refreshes summary before refetching tree paths, then re-runs Find', async () => {
		const { session, calls } = setup(true);
		const r = await session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
		expect(r).toEqual(RESULT);
		expect(calls).toEqual(['summary', 'refetch', 'find']);
	});

	it('undo and redo follow the same protocol — stale Find hits refresh too', async () => {
		const { session, calls } = setup(true);
		await session.undo();
		expect(calls).toEqual(['summary', 'refetch', 'find']);
		calls.length = 0;
		await session.redo();
		expect(calls).toEqual(['summary', 'refetch', 'find']);
	});

	it('a closed Find is not re-run', async () => {
		const { session, calls, find } = setup(false);
		await session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
		expect(calls).toEqual(['summary', 'refetch']);
		expect(find.runSearch).not.toHaveBeenCalled();
	});

	it('an exhausted undo stack short-circuits the protocol', async () => {
		const { session, calls } = setup(true);
		vi.mocked(ipc.docUndo).mockResolvedValue(null as never);
		const r = await session.undo();
		expect(r).toBeNull();
		expect(calls).toEqual([]);
	});

	it('a failing mutation reports the error and skips the refresh chain', async () => {
		const { session, calls, deps } = setup(true);
		vi.mocked(ipc.docApplyOp).mockRejectedValue(new Error('edit boom'));
		const r = await session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
		expect(r).toBeNull();
		expect(deps.setError).toHaveBeenCalled();
		expect(calls).toEqual([]);
	});
});
