// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { NodeView } from '$lib/ipc/bindings';
import type { TabSlot } from '$lib/shell/state/workspace.svelte';
import { PaneCommandBus } from '$lib/shell/state/pane-bus';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => {}),
		cancelJob: vi.fn(async () => true),
		docGetSlice: vi.fn(),
		docApplyOp: vi.fn(),
		docUndo: vi.fn(),
		docColumnSchema: vi.fn(async () => null),
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
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
	configurable: true,
	get: () => 600,
});
Element.prototype.scrollTo = () => {};

const slot = {
	register: () => () => {},
	handoff: null,
	isHandleAlive: () => true,
	versionOf: () => null,
} as unknown as TabSlot;

const summary = {
	rootKind: 'object' as const,
	rootChildCount: 3,
	sourcePath: '/w/m.json',
	sourceSize: 40,
	lazy: false,
	version: 1,
	dirty: false,
	fileBacked: true,
	recoveryNote: null,
	commentsStripped: false,
};

const nv = (key: string, kind: NodeView['kind'], preview: string, childCount: number | null) => ({
	key,
	kind,
	preview,
	childCount,
});

describe('row menu', () => {
	it('removes the row it was opened on while rows above it were still loading', async () => {
		vi.mocked(ipc.docOpen).mockResolvedValue({
			kind: 'opened',
			handle: 'M' as never,
			summary,
			notes: { convertedFrom: null, repairs: [] },
		});
		vi.mocked(ipc.docSummary).mockResolvedValue({ ...summary, version: 2 });
		vi.mocked(ipc.docApplyOp).mockResolvedValue({ version: 2, affectedPaths: [[]] });
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) => {
			if (path.length === 0)
				return [
					nv('a', 'object', '', 2),
					nv('b', 'number', '1', null),
					nv('c', 'number', '2', null),
				];
			await gate;
			return [nv('x', 'number', '7', null), nv('y', 'number', '8', null)];
		});

		const { container } = render(DocPane, {
			props: {
				tabId: 'tab-menu',
				slot,
				isActive: false,
				pendingOpen: { kind: 'file', path: '/w/m.json' },
			},
		});
		const rowWithKey = (k: string) =>
			[...container.querySelectorAll<HTMLElement>('.r')].find(
				(el) => el.querySelector('.k')?.textContent === k,
			)!;
		await vi.waitFor(() => expect(rowWithKey('c')).toBeTruthy());

		await fireEvent.click(rowWithKey('a'));
		await fireEvent.contextMenu(rowWithKey('c'));
		release();
		await vi.waitFor(() => expect(rowWithKey('y')).toBeTruthy());

		await fireEvent.click(within(document.body).getByRole('menuitem', { name: /Remove/ }));
		await vi.waitFor(() => expect(ipc.docApplyOp).toHaveBeenCalled());
		expect(ipc.docApplyOp).toHaveBeenCalledWith('M', { kind: 'deleteKey', path: [], key: 'c' });
	});

	it('closes without acting when its row disappears, even if another row takes its place', async () => {
		vi.mocked(ipc.docApplyOp).mockClear();
		vi.mocked(ipc.docOpen).mockResolvedValue({
			kind: 'opened',
			handle: 'G' as never,
			summary,
			notes: { convertedFrom: null, repairs: [] },
		});
		vi.mocked(ipc.docSummary).mockResolvedValue({ ...summary, version: 2 });
		vi.mocked(ipc.docUndo).mockResolvedValue({ version: 2, affectedPaths: [[]] });
		let rootKeys = ['a', 'b', 'c'];
		vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) =>
			path.length === 0 ? rootKeys.map((k) => nv(k, 'number', '1', null)) : [],
		);
		const paneBus = new PaneCommandBus();
		const { container } = render(DocPane, {
			props: {
				tabId: 'tab-gone',
				slot,
				isActive: false,
				pendingOpen: { kind: 'file', path: '/w/m.json' },
				paneBus,
			},
		});
		const rowWithKey = (k: string) =>
			[...container.querySelectorAll<HTMLElement>('.r')].find(
				(el) => el.querySelector('.k')?.textContent === k,
			);
		await vi.waitFor(() => expect(rowWithKey('c')).toBeTruthy());
		await fireEvent.contextMenu(rowWithKey('c')!);
		expect(within(document.body).queryByRole('menuitem', { name: /Remove/ })).not.toBeNull();

		rootKeys = ['a', 'b', 'd'];
		paneBus.dispatch('tab-gone', { kind: 'history', delta: -1 });
		await vi.waitFor(() => expect(rowWithKey('d')).toBeTruthy());
		await new Promise((r) => setTimeout(r, 50));

		expect(within(document.body).queryByRole('menuitem', { name: /Remove/ })).toBeNull();
		expect(ipc.docApplyOp).not.toHaveBeenCalled();
	});
});
