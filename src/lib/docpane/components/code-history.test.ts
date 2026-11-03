// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { ipc } from '$lib/ipc/client';
import { PaneCommandBus } from '$lib/shell/state/pane-bus';
import type { TabSlot } from '$lib/shell/state/workspace.svelte';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => {}),
		cancelJob: vi.fn(async () => true),
		docCanonicalText: vi.fn(),
		docCanonicalOffsets: vi.fn(async () => []),
		docGetSlice: vi.fn(async () => []),
		docUndo: vi.fn(),
		docRedo: vi.fn(),
		docSetRootText: vi.fn(),
		docColumnSchema: vi.fn(async () => null),
		docBackup: vi.fn(async () => {}),
		docBackupClear: vi.fn(async () => {}),
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

const json = (a: number) => `{\n  "a": ${a}\n}`;

let text = '';
let undo: string[] = [];
let redo: string[] = [];
let version = 1;
let undoGate: Promise<void> | null = null;

const summary = () => ({
	rootKind: 'object' as const,
	rootChildCount: 1,
	sourcePath: '/w/a.json',
	sourceSize: 20,
	lazy: false,
	version,
	dirty: true,
	fileBacked: true,
	recoveryNote: null,
	commentsStripped: false,
});

beforeEach(() => {
	vi.clearAllMocks();
	text = json(1);
	undo = [json(0)];
	redo = [];
	version = 1;
	undoGate = null;
	vi.mocked(ipc.docOpen).mockImplementation(async () => ({
		kind: 'opened',
		handle: 'H' as never,
		summary: summary(),
		notes: { convertedFrom: null, repairs: [] },
	}));
	vi.mocked(ipc.docCanonicalText).mockImplementation(async () => text as never);
	vi.mocked(ipc.docSummary).mockImplementation(async () => summary());
	vi.mocked(ipc.docSetRootText).mockImplementation(async (_h, t) => {
		undo.push(text);
		text = t;
		redo = [];
		return { version: ++version, affectedPaths: [[]] };
	});
	vi.mocked(ipc.docUndo).mockImplementation(async () => {
		if (undoGate) await undoGate;
		const prev = undo.pop();
		if (prev === undefined) return null;
		redo.push(text);
		text = prev;
		return { version: ++version, affectedPaths: [[]] };
	});
	vi.mocked(ipc.docRedo).mockImplementation(async () => {
		const next = redo.pop();
		if (next === undefined) return null;
		undo.push(text);
		text = next;
		return { version: ++version, affectedPaths: [[]] };
	});
});

async function openInCode(tabId: string) {
	const paneBus = new PaneCommandBus();
	const { container } = render(DocPane, {
		props: {
			tabId,
			slot,
			isActive: false,
			pendingOpen: { kind: 'file', path: '/w/a.json' },
			paneBus,
		},
	});
	await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
	await fireEvent.click(within(container).getByText('Code'));
	await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
	const view = () => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
	await vi.waitFor(() => expect(view().state.doc.toString()).toBe(json(1)));
	const type = (t: string) =>
		view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: t } });
	return { container, paneBus, view, type };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('History step while the Code view is showing', () => {
	it('shows the document after the step, not the text from before it', async () => {
		const { paneBus, view } = await openInCode('tab-hist-1');
		paneBus.dispatch('tab-hist-1', { kind: 'history', delta: -1 });
		await vi.waitFor(() => expect(view().state.doc.toString()).toBe(json(0)));
		expect(ipc.docUndo).toHaveBeenCalledTimes(1);
	});

	it('commits uncommitted edits once, then lands on the step that was clicked', async () => {
		const { paneBus, view, type } = await openInCode('tab-hist-2');
		type(json(9));
		paneBus.dispatch('tab-hist-2', { kind: 'history', delta: -1 });
		await vi.waitFor(() => expect(view().state.doc.toString()).toBe(json(0)));
		await settle();
		expect(ipc.docSetRootText).toHaveBeenCalledTimes(1);
		expect(text).toBe(json(0));
		expect(redo).toEqual([json(9), json(1)]);
	});

	it('does not commit text typed while the step was running', async () => {
		const { paneBus, view, type } = await openInCode('tab-hist-3');
		let release!: () => void;
		undoGate = new Promise<void>((r) => (release = r));
		paneBus.dispatch('tab-hist-3', { kind: 'history', delta: -1 });
		await vi.waitFor(() => expect(ipc.docUndo).toHaveBeenCalled());
		type(json(5));
		release();
		await vi.waitFor(() => expect(view().state.doc.toString()).toBe(json(0)));
		await settle();
		expect(ipc.docSetRootText).not.toHaveBeenCalled();
		expect(text).toBe(json(0));
	});

	it('keeps the redo steps when a redo is clicked with uncommitted edits', async () => {
		redo = [json(2)];
		const { container, paneBus, type } = await openInCode('tab-hist-4');
		type(json(9));
		paneBus.dispatch('tab-hist-4', { kind: 'history', delta: 1 });
		await vi.waitFor(() => expect(container.querySelector('.banner-err')).not.toBeNull());
		expect(ipc.docSetRootText).not.toHaveBeenCalled();
		expect(ipc.docRedo).not.toHaveBeenCalled();
		expect(redo).toEqual([json(2)]);
	});
});
