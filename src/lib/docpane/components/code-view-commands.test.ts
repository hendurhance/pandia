// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SMALL_TIER } from '$lib/ipc/fake';
import { fireEvent, render, within } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { ipc } from '$lib/ipc/client';
import type { NodeView } from '$lib/ipc/bindings';
import type { PaneView, TabSlot } from '$lib/shell/state/workspace.svelte';
import { commandRegistry } from '$lib/palette/state/command-store.svelte';
import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => {}),
		cancelJob: vi.fn(async () => true),
		docCanonicalText: vi.fn(),
		docCanonicalOffsets: vi.fn(async () => []),
		docGetSlice: vi.fn(),
		docSetRootText: vi.fn(),
		docApplyOp: vi.fn(),
		docSearch: vi.fn(async () => []),
		docBackup: vi.fn(async () => {}),
		docBackupText: vi.fn(async () => {}),
		docBackupClear: vi.fn(async () => {}),
		docColumnSchema: vi.fn(async () => null),
		e2eRecord: vi.fn(async () => {}),
	}),
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
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
	configurable: true,
	get: () => 600,
});
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollTo = () => {};

const ROW_COMMANDS = [
	'tree.moveUp',
	'tree.moveDown',
	'tree.sortKeysAsc',
	'tree.sortKeysDesc',
	'edit.copy',
	'edit.copyPath',
	'edit.cut',
	'edit.paste',
	'edit.extract',
];

const TEXT = '{\n  "b": {\n    "y": 2,\n    "x": 1\n  },\n  "a": 1\n}';

let dirty = false;
let views: Record<string, PaneView> = {};

const slotFor = (tabId: string) =>
	({
		register: (v: PaneView) => {
			views[tabId] = v;
			return () => {};
		},
		handoff: null,
		isHandleAlive: () => true,
		versionOf: () => null,
		resolveUnsaved: async () => true,
	}) as unknown as TabSlot;

const summary = () => ({
	rootKind: 'object' as const,
	rootChildCount: 2,
	sourcePath: '/w/a.json',
	sourceSize: TEXT.length,
	lazy: false,
	version: 1,
	dirty,
	fileBacked: true,
	recoveryNote: null,
	commentsStripped: false,
	...SMALL_TIER,
});

const nv = (key: string, kind: NodeView['kind'], preview: string, childCount: number | null) => ({
	key,
	kind,
	preview,
	childCount,
});

beforeEach(() => {
	vi.clearAllMocks();
	dirty = false;
	views = {};
	vi.mocked(ipc.docOpen).mockImplementation(async () => ({
		kind: 'opened',
		handle: 'H' as never,
		summary: summary(),
		notes: { convertedFrom: null, repairs: [] },
	}));
	vi.mocked(ipc.docSummary).mockImplementation(async () => summary());
	vi.mocked(ipc.docCanonicalText).mockResolvedValue(TEXT as never);
	vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) =>
		path.length === 0 ? [nv('b', 'object', '', 2), nv('a', 'number', '1', null)] : [],
	);
});

function open(tabId: string) {
	const { container, rerender } = render(DocPane, {
		props: {
			tabId,
			slot: slotFor(tabId),
			isActive: true,
			pendingOpen: { kind: 'file', path: '/w/a.json' },
		},
	});
	const editor = () =>
		EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
	const rowWithKey = (k: string) =>
		[...container.querySelectorAll<HTMLElement>('.r')].find(
			(el) => el.querySelector('.k')?.textContent === k,
		);
	return { container, rerender, editor, rowWithKey };
}

const enabledRowCommands = () =>
	ROW_COMMANDS.filter((id) => commandRegistry.get(id)?.enabled?.() ?? true);

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('Tree row commands while the Code view is showing', () => {
	it('are greyed out, so none of them changes the document behind the editor', async () => {
		const { container, rowWithKey } = open('rows-palette');
		await vi.waitFor(() => expect(rowWithKey('b')).toBeTruthy());
		await fireEvent.click(rowWithKey('b')!);
		expect(enabledRowCommands()).toEqual(ROW_COMMANDS);

		commandRegistry.run('view.code');
		await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
		expect(enabledRowCommands()).toEqual([]);
		for (const id of ROW_COMMANDS) commandRegistry.run(id);
		await settle();
		expect(ipc.docApplyOp).not.toHaveBeenCalled();
	});

	it('a row menu left open closes when the Code view opens', async () => {
		const { container, rowWithKey } = open('rows-menu');
		await vi.waitFor(() => expect(rowWithKey('b')).toBeTruthy());
		await fireEvent.contextMenu(rowWithKey('b')!);
		expect(within(document.body).queryByRole('menuitem', { name: /Remove/ })).not.toBeNull();

		commandRegistry.run('view.code');
		await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
		expect(within(document.body).queryByRole('menuitem', { name: /Remove/ })).toBeNull();
	});
});

describe('Close Document with uncommitted Code view edits', () => {
	it('the next document opened in the tab starts saved', async () => {
		await sidebarPrefs.init();
		sidebarPrefs.setDefaultView('code');
		try {
			const { container, rerender, editor } = open('close-dirty');
			const status = () => views['close-dirty']?.status;
			await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
			await vi.waitFor(() => expect(editor().state.doc.toString()).toBe(TEXT));
			editor().dispatch({
				changes: { from: 0, to: editor().state.doc.length, insert: '{ broken' },
			});
			await vi.waitFor(() => expect(status()?.dirty).toBe(true));

			commandRegistry.run('doc.close');
			await vi.waitFor(() => expect(status()).toBeNull());
			await rerender({ pendingOpen: { kind: 'file', path: '/w/b.json' } });
			await vi.waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
			await vi.waitFor(() => expect(editor().state.doc.toString()).toBe(TEXT));
			await settle();
			expect(status()?.dirty).toBe(false);
		} finally {
			sidebarPrefs.setDefaultView('tree');
		}
	});
});

describe('Closing Find with Escape', () => {
	it('gives focus back to the tree row that had it', async () => {
		const { container, rowWithKey } = open('find-focus');
		await vi.waitFor(() => expect(rowWithKey('b')).toBeTruthy());
		const row = rowWithKey('b')!;
		row.focus();

		commandRegistry.run('find.open');
		const input = await vi.waitFor(() => {
			const el = container.querySelector<HTMLInputElement>('input[aria-label="search query"]');
			expect(document.activeElement).toBe(el);
			return el!;
		});
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(container.querySelector('input[aria-label="search query"]')).toBeNull();
		expect(document.activeElement).toBe(row);
	});
});
