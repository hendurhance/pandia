// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { DocumentSession, type DocumentSessionDeps } from './document-session.svelte';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import type { CodeViewApi } from '$lib/views/code/CodeView.svelte';
import type { Path, SearchHit } from '$lib/ipc/bindings';
import { asLosslessText } from '$lib/ipc/wire';
import type { ContentRow } from '$lib/views/tree/logic/model';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docGetValue: vi.fn(),
		docApplyOp: vi.fn(),
		docSetRootText: vi.fn(),
		docUndo: vi.fn(),
		docRedo: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => true),
		docBackupClear: vi.fn(async () => null),
		docOpen: vi.fn(),
		docGetSlice: vi.fn(async () => []),
		docChildCount: vi.fn(),
		docSearch: vi.fn(async () => []),
		cancelJob: vi.fn(),
		docReplace: vi.fn(),
		docDiff: vi.fn(),
		docDiffLines: vi.fn(),
		docSave: vi.fn(),
		docDiagnose: vi.fn(),
	},
}));

const clipboard = vi.hoisted(() => {
	let text = '';
	return {
		writeText: async (t: string) => void (text = t),
		readText: async () => text,
	};
});
vi.mock('@tauri-apps/plugin-clipboard-manager', () => clipboard);

function stubDeps(overrides: Partial<DocumentSessionDeps> = {}): DocumentSessionDeps {
	return {
		isActive: () => true,
		onOpenInNewTab: () => {},
		isHandleAlive: () => true,
		code: { api: () => null, dirty: () => false },
		graphApi: () => null,
		clearViewState: () => {},
		...overrides,
	};
}

describe('DocumentSession — one owner for the pane wiring', () => {
	it('constructs with correct initial state', () => {
		const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps()));
		try {
			expect(doc.error).toBeNull();
			expect(doc.busy).toBe(false);
			expect(doc.viewMode).toBe('tree');
		} finally {
			destroy();
		}
	});

	it('switchView moves freely when the code buffer is clean', async () => {
		const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps()));
		try {
			await doc.switchView('grid');
			expect(doc.viewMode).toBe('grid');
		} finally {
			destroy();
		}
	});

	it('switchView away from a dirty code view is gated on the flush', async () => {
		const flush = vi.fn(async () => false);
		const api = { flush } as unknown as CodeViewApi;
		const { result: doc, destroy } = inRoot(
			() => new DocumentSession(stubDeps({ code: { api: () => api, dirty: () => true } })),
		);
		try {
			doc.viewMode = 'code';
			await doc.switchView('tree');
			expect(flush).toHaveBeenCalledTimes(1);
			expect(doc.viewMode).toBe('code'); // refused flush keeps the view

			flush.mockResolvedValue(true);
			await doc.switchView('tree');
			expect(doc.viewMode).toBe('tree');
		} finally {
			destroy();
		}
	});

	it('navigating or comparing away from a dirty code view is gated on the flush too', async () => {
		const flush = vi.fn(async () => false);
		const api = { flush } as unknown as CodeViewApi;
		const { result: doc, destroy } = inRoot(
			() => new DocumentSession(stubDeps({ code: { api: () => api, dirty: () => true } })),
		);
		try {
			doc.session.handle = 'main' as never;
			doc.viewMode = 'code';
			await doc.nav.navigateTo(['a']);
			expect(doc.viewMode).toBe('code');

			await doc.compare.start({ kind: 'tab', handle: 'other' as never, sourceName: 'b.json' });
			expect(doc.viewMode).toBe('code');
			expect(ipc.docSummary).not.toHaveBeenCalled();
			expect(flush).toHaveBeenCalledTimes(2);
		} finally {
			destroy();
		}
	});

	it('isDirty folds the code buffer into the document dirty state', () => {
		const { result: doc, destroy } = inRoot(
			() => new DocumentSession(stubDeps({ code: { api: () => null, dirty: () => true } })),
		);
		try {
			expect(doc.isDirty).toBe(true);
		} finally {
			destroy();
		}
	});

	it('flash shows and then clears the banner', () => {
		vi.useFakeTimers();
		try {
			const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps()));
			doc.flash('saved x');
			expect(doc.saveFlash).toBe('saved x');
			vi.advanceTimersByTime(1500);
			expect(doc.saveFlash).toBeNull();
			destroy();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('DocumentSession — Find after an edit', () => {
	const EDITED = { version: 2, affectedPaths: [] };
	const hits = (items: number[]): SearchHit[] =>
		items.map((i) => ({
			path: ['items', i, 'name'],
			kind: 'string',
			matchField: 'value',
			snippet: 'name',
		}));
	const twenty = [...Array(20).keys()];
	const settle = () => new Promise((r) => setTimeout(r));

	function findOpen(overrides: Partial<DocumentSessionDeps> = {}) {
		const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps(overrides)));
		doc.session.handle = 'h' as never;
		doc.find.open = true;
		doc.find.query = 'name';
		vi.mocked(ipc.docSummary).mockResolvedValue({ version: 2 } as never);
		return { doc, destroy };
	}

	it('keeps the active hit when an edit adds a match before it, without moving the view', async () => {
		const { doc, destroy } = findOpen();
		try {
			const navigateTo = vi.spyOn(doc.nav, 'navigateTo').mockResolvedValue();
			vi.mocked(ipc.docSearch).mockResolvedValue(hits(twenty));
			await doc.find.runSearch('name');
			await doc.find.jumpToHit(6);
			navigateTo.mockClear();

			vi.mocked(ipc.docSearch).mockResolvedValue(hits([99, ...twenty]));
			vi.mocked(ipc.docApplyOp).mockResolvedValue(EDITED as never);
			await doc.session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
			await settle();

			expect(doc.find.activeIdx).toBe(7);
			expect(doc.find.hits[7]?.path).toEqual(['items', 6, 'name']);
			expect(navigateTo).not.toHaveBeenCalled();
		} finally {
			destroy();
		}
	});

	it('moves to the nearest remaining hit when an undo removes the active one', async () => {
		const { doc, destroy } = findOpen();
		try {
			const navigateTo = vi.spyOn(doc.nav, 'navigateTo').mockResolvedValue();
			vi.mocked(ipc.docSearch).mockResolvedValue(hits(twenty));
			await doc.find.runSearch('name');
			await doc.find.jumpToHit(6);
			navigateTo.mockClear();

			vi.mocked(ipc.docSearch).mockResolvedValue(hits(twenty.filter((i) => i !== 6)));
			vi.mocked(ipc.docUndo).mockResolvedValue(EDITED as never);
			await doc.session.runHistory(-1);
			await settle();

			expect(doc.find.hits[doc.find.activeIdx]?.path).toEqual(['items', 7, 'name']);
			expect(navigateTo).not.toHaveBeenCalled();
		} finally {
			destroy();
		}
	});

	it('searches again when Find is reopened after an edit made while it was closed', async () => {
		const { doc, destroy } = findOpen();
		try {
			vi.spyOn(doc.nav, 'navigateTo').mockResolvedValue();
			vi.mocked(ipc.docSearch).mockResolvedValue(hits(twenty));
			await doc.find.runSearch('name');
			doc.find.close();

			vi.mocked(ipc.docSearch).mockResolvedValue(hits([0, 1]));
			vi.mocked(ipc.docApplyOp).mockResolvedValue(EDITED as never);
			await doc.session.applyOp({ kind: 'deleteKey', path: [], key: 'x' });
			doc.find.openFind();
			await settle();

			expect(doc.find.counter).toBe('1 / 2');
		} finally {
			destroy();
		}
	});

	it('reopening Find without an edit reuses the hits it has', async () => {
		const { doc, destroy } = findOpen();
		try {
			vi.spyOn(doc.nav, 'navigateTo').mockResolvedValue();
			vi.mocked(ipc.docSearch).mockClear().mockResolvedValue(hits(twenty));
			await doc.find.runSearch('name');
			doc.find.close();
			doc.find.openFind();
			await settle();

			expect(ipc.docSearch).toHaveBeenCalledTimes(1);
		} finally {
			destroy();
		}
	});

	it('in Code view, recounts the matches in the editor and stays in Code view', async () => {
		const cmCount = vi.fn(() => 2);
		const api = { cmCount } as unknown as CodeViewApi;
		const { doc, destroy } = findOpen({ code: { api: () => api, dirty: () => false } });
		try {
			vi.mocked(ipc.docSearch).mockResolvedValue(hits(twenty));
			await doc.find.runSearch('name');
			doc.viewMode = 'code';

			vi.mocked(ipc.docSearch).mockClear();
			vi.mocked(ipc.docSetRootText).mockResolvedValue(EDITED as never);
			await doc.session.commitText('{"items": []}');
			await settle();

			expect(doc.viewMode).toBe('code');
			expect(doc.find.codeMatchCount).toBe(2);

			// The tree hits predate the edit, so going back to Tree searches again.
			await doc.switchView('tree');
			doc.find.syncActiveView();
			expect(ipc.docSearch).toHaveBeenCalledTimes(1);
		} finally {
			destroy();
		}
	});
});

describe('DocumentSession — the cut follows its item', () => {
	const RESULT = { version: 2, affectedPaths: [] };
	const row = (path: Path) =>
		({ path, key: path[path.length - 1], depth: path.length, kind: 'object' }) as ContentRow;

	function withItems(names: string[]) {
		const items = names.map((name) => JSON.stringify({ name }));
		vi.mocked(ipc.docGetValue).mockImplementation(async (_h, p: Path) =>
			asLosslessText(items[p[0] as number] ?? 'null'),
		);
		vi.mocked(ipc.docApplyOp).mockImplementation(async (_h, op) => {
			if (op.kind === 'deleteItem') items.splice(op.index, 1);
			else if (op.kind === 'insertItemText') items.splice(op.index, 0, op.text);
			else if (op.kind === 'setValueText') items[op.path[0] as number] = `{"name":${op.text}}`;
			else throw new Error(`unexpected ${op.kind}`);
			return RESULT as never;
		});
		vi.mocked(ipc.docSummary).mockResolvedValue({ version: 2 } as never);
		const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps()));
		doc.session.handle = 'h' as never;
		return { doc, destroy, names: () => items.map((t) => JSON.parse(t).name) };
	}

	it('keeps the cut on its item when an earlier item is removed, so paste moves it', async () => {
		const { doc, destroy, names } = withItems(['a', 'b', 'c', 'd']);
		try {
			await doc.nodeActions.cut(row([2]));
			await doc.nodeActions.remove(row([0]));
			expect(doc.cutMark?.path).toEqual([1]);
			await doc.nodeActions.paste(row([0]));
			expect(names()).toEqual(['b', 'c', 'd']);
			expect(doc.cutMark).toBeNull();
		} finally {
			destroy();
		}
	});

	it('drops the cut when its item is removed', async () => {
		const { doc, destroy } = withItems(['a', 'b', 'c']);
		try {
			await doc.nodeActions.cut(row([1]));
			await doc.nodeActions.remove(row([1]));
			expect(doc.cutMark).toBeNull();
		} finally {
			destroy();
		}
	});

	it.each([
		['an undo', (doc: DocumentSession) => doc.session.undo()],
		['a redo', (doc: DocumentSession) => doc.session.redo()],
		['a code commit', (doc: DocumentSession) => doc.session.commitText('[]')],
		[
			'Replace All',
			(doc: DocumentSession) => {
				doc.find.query = 'a';
				return doc.find.replaceAll();
			},
		],
		['opening another document', (doc: DocumentSession) => doc.session.reset()],
	])('drops the cut after %s, which it cannot follow', async (_, change) => {
		const { doc, destroy } = withItems(['a', 'b', 'c']);
		vi.mocked(ipc.docUndo).mockResolvedValue(RESULT as never);
		vi.mocked(ipc.docRedo).mockResolvedValue(RESULT as never);
		vi.mocked(ipc.docSetRootText).mockResolvedValue(RESULT as never);
		vi.mocked(ipc.docReplace).mockResolvedValue({ count: 1, applied: RESULT } as never);
		try {
			await doc.nodeActions.cut(row([1]));
			expect(doc.cutMark?.path).toEqual([1]);
			await change(doc);
			expect(doc.cutMark).toBeNull();
		} finally {
			destroy();
		}
	});

	it('refuses to paste when the cut item changed, and leaves the document as it was', async () => {
		const { doc, destroy, names } = withItems(['a', 'b', 'c']);
		try {
			await doc.nodeActions.cut(row([2]));
			await doc.session.applyOp({ kind: 'setValueText', path: [2, 'name'], text: '"z"' });
			await doc.nodeActions.paste(row([0]));
			expect(names()).toEqual(['a', 'b', 'z']);
			expect(doc.error).toBe('The cut item changed. Cut it again.');
			expect(doc.cutMark).toBeNull();
		} finally {
			destroy();
		}
	});
});
