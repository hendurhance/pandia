import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { DocSessionController, type DocSessionDeps } from './doc-session.svelte';
import type { OpenNotes, OpenOutcome, Summary } from '$lib/ipc/bindings';
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
		docOpen: vi.fn(),
		docClose: vi.fn(async () => true),
	},
}));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	behaviorPrefs: { init: async () => {}, autoRepairOnOpen: true },
}));
vi.mock('$lib/shell/state/recents-store.svelte', () => ({ addRecent: vi.fn() }));

const RESULT = { version: 2, affectedPaths: [['a']] };

function setup() {
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
		refreshAfterEdit: vi.fn(() => {
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
		const { session, calls } = setup();
		const r = await session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
		expect(r).toEqual(RESULT);
		expect(calls).toEqual(['summary', 'refetch', 'find']);
	});

	it('undo and redo follow the same protocol — stale Find hits refresh too', async () => {
		const { session, calls } = setup();
		await session.undo();
		expect(calls).toEqual(['summary', 'refetch', 'find']);
		calls.length = 0;
		await session.redo();
		expect(calls).toEqual(['summary', 'refetch', 'find']);
	});

	it('an exhausted undo stack short-circuits the protocol', async () => {
		const { session, calls } = setup();
		vi.mocked(ipc.docUndo).mockResolvedValue(null as never);
		const r = await session.undo();
		expect(r).toBeNull();
		expect(calls).toEqual([]);
	});

	it('a failing mutation reports the error and skips the refresh chain', async () => {
		const { session, calls, deps } = setup();
		vi.mocked(ipc.docApplyOp).mockRejectedValue(new Error('edit boom'));
		const r = await session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
		expect(r).toBeNull();
		expect(deps.setError).toHaveBeenCalled();
		expect(calls).toEqual([]);
	});
});

function summary(sourcePath: string | null): Summary {
	return {
		rootKind: 'object',
		rootChildCount: 1,
		sourcePath,
		sourceSize: 10,
		lazy: false,
		version: 0,
		dirty: false,
		fileBacked: sourcePath?.startsWith('/') ?? false,
		recoveryNote: null,
		commentsStripped: false,
	} as Summary;
}

function opened(
	sourcePath: string | null,
	notes: Partial<OpenNotes> = {},
	handle = 'h1',
): OpenOutcome {
	return {
		kind: 'opened',
		handle: handle as never,
		summary: summary(sourcePath),
		notes: { convertedFrom: null, repairs: [], ...notes },
	};
}

describe('DocSessionController — opening a source', () => {
	function fresh() {
		vi.clearAllMocks();
		const s = setup();
		s.session.handle = null;
		return s;
	}

	it('closes a slower earlier open instead of letting it replace a newer one', async () => {
		const { session } = fresh();
		let finishBig!: (o: OpenOutcome) => void;
		vi.mocked(ipc.docOpen)
			.mockImplementationOnce(() => new Promise((r) => (finishBig = r)))
			.mockResolvedValueOnce(opened('/w/small.json', {}, 'small'));
		const big = session.loadFromSource({ kind: 'file', path: '/w/big.json' });
		expect(await session.loadFromSource({ kind: 'file', path: '/w/small.json' })).toBe(true);
		finishBig(opened('/w/big.json', {}, 'big'));
		expect(await big).toBe(false);
		expect(session.handle).toBe('small');
		expect(session.sourceName).toBe('/w/small.json');
		expect(ipc.docClose).toHaveBeenCalledWith('big');
	});

	it('closes a document that finishes opening after its tab closed', async () => {
		const { session } = fresh();
		let finish!: (o: OpenOutcome) => void;
		vi.mocked(ipc.docOpen).mockImplementationOnce(() => new Promise((r) => (finish = r)));
		const load = session.loadFromSource({ kind: 'file', path: '/w/big.json' });
		session.dispose();
		await vi.waitFor(() => expect(finish).toBeDefined());
		finish(opened('/w/big.json', {}, 'late'));
		expect(await load).toBe(false);
		expect(session.handle).toBeNull();
		expect(ipc.docClose).toHaveBeenCalledWith('late');
	});

	it('opens in one call, passing the auto-repair setting', async () => {
		const { session } = fresh();
		vi.mocked(ipc.docOpen).mockResolvedValue(opened('/w/a.json'));
		expect(await session.loadFromSource({ kind: 'file', path: '/w/a.json' })).toBe(true);
		expect(ipc.docOpen).toHaveBeenCalledTimes(1);
		expect(ipc.docOpen).toHaveBeenCalledWith({ kind: 'file', path: '/w/a.json' }, { repair: true });
		expect(session.handle).toBe('h1');
		expect(session.sourceName).toBe('/w/a.json');
		expect(session.repairInfo).toBeNull();
	});

	it('shows what repair changed and names the tab after the repaired copy', async () => {
		const { session } = fresh();
		vi.mocked(ipc.docOpen).mockResolvedValue(
			opened('cut.repaired.json', { repairs: ['Removed a trailing comma.'] }),
		);
		await session.loadFromSource({ kind: 'file', path: '/w/cut.json' });
		expect(session.sourceName).toBe('cut.repaired.json');
		expect(session.repairInfo).toEqual({
			title: 'repaired',
			notes: ['Removed a trailing comma.'],
			more: 0,
		});
	});

	it('says what a converted document came from', async () => {
		const { session } = fresh();
		vi.mocked(ipc.docOpen).mockResolvedValue(opened('data.json', { convertedFrom: 'yaml' }));
		await session.loadFromSource({ kind: 'file', path: '/w/data.yaml' });
		expect(session.repairInfo).toEqual({ title: 'converted from YAML', notes: [], more: 0 });
	});

	it('shows a plain error and the diagnosis when a source cannot be opened', async () => {
		const { session, deps } = fresh();
		const diagnosis = { title: 'One comma too many', detail: 'x', excerpt: null, fix: null };
		vi.mocked(ipc.docOpen).mockResolvedValue({
			kind: 'failed',
			detail: 'trailing comma at line 1 column 9',
			tooLargeToFix: false,
			diagnosis,
		});
		expect(await session.loadFromSource({ kind: 'text', text: '{,}', name: null })).toBe(false);
		expect(deps.setError).toHaveBeenLastCalledWith(
			"This isn't valid JSON: trailing comma at line 1 column 9.",
		);
		expect(session.diagnosis).toEqual(diagnosis);
		expect(session.handle).toBeNull();
	});

	it('keeps the file name when the suggested fix for a failed open is applied', async () => {
		const { session } = fresh();
		vi.mocked(ipc.docOpen)
			.mockResolvedValueOnce({
				kind: 'failed',
				detail: 'trailing comma at line 1 column 9',
				tooLargeToFix: false,
				diagnosis: { title: 'One comma too many', detail: 'x', excerpt: null, fix: null },
			})
			.mockResolvedValueOnce(opened('config.json'));
		await session.loadFromSource({ kind: 'file', path: '/w/config.json' });
		await session.applyDiagnosisFix('{"a": 1}');
		expect(ipc.docOpen).toHaveBeenLastCalledWith(
			{ kind: 'text', text: '{"a": 1}', name: 'config.json' },
			{ repair: true },
		);
	});
});
