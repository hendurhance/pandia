// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { ipc } from '$lib/ipc/client';
import type { TabSlot } from '$lib/shell/state/workspace.svelte';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => {}),
		cancelJob: vi.fn(async () => true),
		docCanonicalText: vi.fn(async () => '{\n  "a": 1\n}'),
		docCanonicalOffsets: vi.fn(async () => []),
		docGetSlice: vi.fn(async () => []),
		docSetRootText: vi.fn(async () => ({ version: 2, affectedPaths: [[]] })),
		docBackup: vi.fn(async () => {}),
		docBackupText: vi.fn(async () => {}),
		docBackupClear: vi.fn(async () => {}),
		docColumnSchema: vi.fn(async () => null),
		e2eRecord: vi.fn(async () => {}),
	},
}));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollTo = () => {};

const slot = {
	register: () => () => {},
	handoff: null,
	isHandleAlive: () => true,
	versionOf: () => null,
} as unknown as TabSlot;

const summary = {
	rootKind: 'object' as const,
	rootChildCount: 1,
	sourcePath: '/w/c.json',
	sourceSize: 12,
	lazy: false,
	version: 1,
	dirty: false,
	fileBacked: true,
	recoveryNote: null,
	commentsStripped: false,
};

async function openInCode(tabId: string) {
	vi.clearAllMocks();
	vi.mocked(ipc.docOpen).mockResolvedValue({
		kind: 'opened',
		handle: 'C' as never,
		summary,
		notes: { convertedFrom: null, repairs: [] },
	});
	vi.mocked(ipc.docSummary).mockResolvedValue({ ...summary, version: 2, dirty: true });
	const { container } = render(DocPane, {
		props: { tabId, slot, isActive: true, pendingOpen: { kind: 'file', path: '/w/c.json' } },
	});
	await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
	await fireEvent.click(within(container).getByText('Code'));
	await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
	const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
	await vi.waitFor(() => expect(view.state.doc.toString()).toBe('{\n  "a": 1\n}'));
	const type = (t: string) =>
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
	return { container, view, type };
}

const pause = () => new Promise((r) => setTimeout(r, 1000));

describe('typing in the Code view, then pausing', () => {
	it('backs up the typed text, leaves the document unchanged until ⌘⏎, and Esc reverts', async () => {
		const { view, type } = await openInCode('tab-code-buf-1');
		type('{\n  "a": 2\n}');
		await pause();

		expect(ipc.docSetRootText).not.toHaveBeenCalled();
		expect(ipc.docBackupText).toHaveBeenCalledWith('C', '/w/c.json', '{\n  "a": 2\n}');

		await fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
		expect(view.state.doc.toString()).toBe('{\n  "a": 1\n}');
		await vi.waitFor(() => expect(ipc.docBackupClear).toHaveBeenCalled());
		expect(ipc.docSetRootText).not.toHaveBeenCalled();
	});

	it('backs up half-typed text as it is, without flagging a commit error', async () => {
		const { container, type } = await openInCode('tab-code-buf-2');
		type('{\n  "a": 2,\n');
		await pause();

		expect(ipc.docBackupText).toHaveBeenCalledWith('C', '/w/c.json', '{\n  "a": 2,\n');
		expect(container.querySelector('.edit-bar')).toBeNull();
		expect(ipc.docSetRootText).not.toHaveBeenCalled();
	});
});
