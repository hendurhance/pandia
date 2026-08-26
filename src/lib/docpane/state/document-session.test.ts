// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DocumentSession, type DocumentSessionDeps } from './document-session.svelte';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import type { CodeViewApi } from '$lib/views/code/CodeView.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
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
	it('constructs the full controller graph with shared state', () => {
		const { result: doc, destroy } = inRoot(() => new DocumentSession(stubDeps()));
		try {
			expect(doc.session).toBeDefined();
			expect(doc.tree).toBeDefined();
			expect(doc.edit).toBeDefined();
			expect(doc.find).toBeDefined();
			expect(doc.compare).toBeDefined();
			expect(doc.nav).toBeDefined();
			expect(doc.nodeActions).toBeDefined();
			expect(doc.menuAction).toBeDefined();
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
