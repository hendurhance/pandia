// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMALL_TIER } from '$lib/ipc/fake';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { listen } from '@tauri-apps/api/event';
import { ipc } from '$lib/ipc/client';
import type { BackupInfo, OpenOutcome, OpenSource } from '$lib/ipc/bindings';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { savePersisted, TABS_FILE } from '$lib/util/persist';
import { commandRegistry } from '$lib/palette/state/command-store.svelte';
import { updateCheck } from '$lib/shell/state/update-check.svelte';
import AppShell from './AppShell.svelte';

Element.prototype.scrollIntoView = () => {};

const h = vi.hoisted(() => ({
	settingsGate: null as Promise<void> | null,
	fns: {} as Record<string, ReturnType<typeof import('vitest').vi.fn>>,
	onClose: null as ((event: { preventDefault: () => void }) => Promise<void>) | null,
	destroyed: 0,
	atDestroy: null as (() => void) | null,
}));

vi.mock('$lib/ipc/client', async () => {
	const { vi } = await import('vitest');
	const ipc = new Proxy(h.fns, {
		get(target, key) {
			if (typeof key !== 'string' || key === 'then') return undefined;
			target[key] ??= vi.fn(async () => null);
			return target[key];
		},
	});
	return { ipc };
});
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => {
		await h.settingsGate;
		return undefined;
	}),
	savePersisted: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({
		onCloseRequested: async (handler: NonNullable<typeof h.onClose>) => {
			h.onClose = handler;
			return () => {};
		},
		onDragDropEvent: async () => () => {},
		startDragging: async () => {},
		destroy: async () => {
			h.destroyed += 1;
			h.atDestroy?.();
		},
	}),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn(),
	save: vi.fn(),
	message: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => null) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.9') }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
	writeText: vi.fn(async () => {}),
	readText: vi.fn(async () => ''),
}));

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Element.prototype.scrollTo = () => {};
window.matchMedia ??= ((q: string) => ({
	matches: false,
	media: q,
	addEventListener() {},
	removeEventListener() {},
})) as unknown as typeof window.matchMedia;

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
	for (const fn of Object.values(h.fns)) fn.mockReset();
	vi.mocked(listen).mockClear();
	vi.mocked(ipc.drainPendingFiles).mockResolvedValue([]);
	vi.mocked(ipc.docBackupScan).mockResolvedValue([]);
	vi.mocked(ipc.e2eEnabled).mockResolvedValue(false);
	vi.mocked(ipc.docGetSlice).mockResolvedValue([]);
	vi.mocked(ipc.docGetValue).mockRejectedValue(new Error('no $schema'));
	vi.mocked(ipc.docClose).mockResolvedValue(true);
	h.settingsGate = null;
	h.destroyed = 0;
	h.atDestroy = null;
});
afterEach(() => cleanup());

function launchWithEdited(...paths: string[]) {
	vi.mocked(ipc.drainPendingFiles).mockResolvedValueOnce(
		paths.map((path) => ({
			path,
			piped: false,
			schema: null,
			compareWith: null,
			wait: null,
			reply: null,
		})),
	);
	vi.mocked(ipc.docOpen).mockImplementation(
		async (source): Promise<OpenOutcome> => ({
			kind: 'opened',
			handle: (source.kind === 'file' ? source.path : 'text') as never,
			summary: {
				rootKind: 'object',
				rootChildCount: 1,
				sourcePath: source.kind === 'file' ? source.path : null,
				sourceSize: 2,
				lazy: false,
				version: 1,
				dirty: true,
				fileBacked: true,
				recoveryNote: null,
				commentsStripped: false,
				...SMALL_TIER,
			},
			notes: { convertedFrom: null, repairs: [] },
		}),
	);
}

const unsavedPrompt = () => screen.queryByRole('dialog', { name: 'unsaved changes' });

describe('AppShell startup', () => {
	it('drains the files handed in at launch once, even when settings finish loading afterwards', async () => {
		let settingsLoaded!: () => void;
		h.settingsGate = new Promise((r) => (settingsLoaded = r));
		render(AppShell);
		await settle();

		settingsLoaded();
		await settle();

		expect(ipc.drainPendingFiles).toHaveBeenCalledTimes(1);
		const fileOpen = vi.mocked(listen).mock.calls.filter(([name]) => name === 'file-open');
		expect(fileOpen, 'file-open listener registered more than once').toHaveLength(1);
	});
});

describe('opening a large file', () => {
	it('offers one cancel button beside "open anyway"', async () => {
		vi.mocked(ipc.fileSize).mockResolvedValueOnce(300 * 1024 * 1024);
		vi.mocked(ipc.drainPendingFiles).mockResolvedValueOnce([
			{
				path: '/w/big.json',
				piped: false,
				schema: null,
				compareWith: null,
				wait: null,
				reply: null,
			},
		]);
		render(AppShell);
		const dialog = await screen.findByRole('dialog', { name: 'large file' });
		const labels = within(dialog)
			.getAllByRole('button')
			.map((b) => b.textContent?.trim());
		expect(labels.filter((l) => l?.startsWith('cancel'))).toHaveLength(1);
		expect(labels.some((l) => l?.startsWith('open anyway'))).toBe(true);
	});
});

describe('restoring unsaved work after a crash', () => {
	const content = '{"draft":"unsaved words"}';
	const record: BackupInfo = {
		docId: 'old-doc',
		originalPath: '/w/notes.json',
		displayName: '/w/notes.json',
		updatedAt: '1',
		bytes: content.length,
	};
	function restoredDoc(source: OpenSource): OpenOutcome {
		return {
			kind: 'opened',
			handle: 'restored' as never,
			summary: {
				rootKind: 'object',
				rootChildCount: 1,
				sourcePath: '/w/notes.json',
				sourceSize: content.length,
				lazy: false,
				version: 0,
				dirty: source.kind === 'text' && source.unsaved === true,
				fileBacked: false,
				recoveryNote: null,
				commentsStripped: false,
				...SMALL_TIER,
			},
			notes: { convertedFrom: null, repairs: [] },
		};
	}

	it('keeps the backup until the restored document has opened', async () => {
		vi.mocked(ipc.docBackupScan).mockResolvedValue([record]);
		vi.mocked(ipc.docBackupRead).mockResolvedValue(content);
		let finishOpen!: () => void;
		vi.mocked(ipc.docOpen).mockImplementation(
			(source) => new Promise((r) => (finishOpen = () => r(restoredDoc(source)))),
		);
		const { getByText } = render(AppShell);
		await vi.waitFor(() => getByText('restore all'));

		await fireEvent.click(getByText('restore all'));
		await vi.waitFor(() => expect(ipc.docOpen).toHaveBeenCalled());
		await settle();
		const clearedBeforeOpen = vi
			.mocked(ipc.docBackupClear)
			.mock.calls.some(([id]) => id === 'old-doc');
		finishOpen();
		await settle();

		expect(clearedBeforeOpen, 'backup deleted while the restored document was still opening').toBe(
			false,
		);
		expect(ipc.docBackupClear).toHaveBeenCalledWith('old-doc');
		expect(ipc.docBackupRead).toHaveBeenCalledWith('old-doc');
		expect(ipc.docOpen).toHaveBeenCalledWith(
			{ kind: 'text', text: content, name: '/w/notes.json', unsaved: true },
			expect.anything(),
		);
	});

	it('asks before closing a restored document that was never saved', async () => {
		vi.mocked(ipc.docBackupScan).mockResolvedValue([record]);
		vi.mocked(ipc.docBackupRead).mockResolvedValue(content);
		vi.mocked(ipc.docOpen).mockImplementation(async (source) => restoredDoc(source));
		const { getByText, queryByText, container } = render(AppShell);
		await vi.waitFor(() => getByText('restore all'));

		await fireEvent.click(getByText('restore all'));
		await settle(80);
		expect(container.querySelector('.view-modes'), 'restored document is showing').not.toBeNull();

		commandRegistry.run('tab.close');
		await settle(80);

		expect(
			queryByText('unsaved changes'),
			'the restored work closed without an unsaved-changes prompt',
		).not.toBeNull();
	});
});

describe('menu shortcuts while typing in a text field', () => {
	async function menu(id: string) {
		const call = vi.mocked(listen).mock.calls.find(([name]) => name === 'menu-event');
		const handler = call?.[1] as ((e: { payload: string }) => void) | undefined;
		if (!handler) throw new Error('no menu-event listener');
		handler({ payload: id });
		await settle();
	}

	it('⌘Z and ⇧⌘Z undo the typing, not the document', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;
		const field = document.body.appendChild(document.createElement('input'));
		field.focus();

		await menu('doc.undo');
		await menu('doc.redo');
		expect(ipc.docUndo).not.toHaveBeenCalled();
		expect(ipc.docRedo).not.toHaveBeenCalled();
		expect(execCommand.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['undo', 'redo']);

		field.remove();
		await menu('doc.undo');
		expect(ipc.docUndo).toHaveBeenCalledOnce();
	});

	it('⇧⌘V pastes plain text into the field instead of opening the schema panel', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
		vi.mocked(readText).mockResolvedValueOnce('pasted');
		const execCommand = vi.fn(() => true);
		document.execCommand = execCommand;
		const field = document.body.appendChild(document.createElement('textarea'));
		field.focus();

		await menu('view.openSchemaPanel');
		expect(execCommand).toHaveBeenCalledWith('insertText', false, 'pasted');
		expect(container.querySelector('[aria-label="schema"]')).toBeNull();
		field.remove();
	});
});

describe('installing an update', () => {
	it('asks about unsaved changes before it restarts, and stays when the prompt is cancelled', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());

		const update = {
			version: '9.9.9',
			currentVersion: '1.0.9',
			body: '',
			downloadAndInstall: vi.fn(async () => {}),
		} as unknown as Update;
		updateCheck.offer(update);
		await fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));

		const prompt = await vi.waitFor(
			() => unsavedPrompt() ?? Promise.reject(new Error('restarted without asking')),
		);
		expect(relaunch).not.toHaveBeenCalled();
		await fireEvent.click(within(prompt).getByRole('button', { name: /^cancel/ }));
		await settle();
		expect(relaunch).not.toHaveBeenCalled();
		updateCheck.later();
	});
});

describe('unsaved-changes prompts', () => {
	it('asks once when the window close button is pressed twice', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());

		const event = { preventDefault: () => {} };
		void h.onClose?.(event);
		void h.onClose?.(event);
		const prompt = await vi.waitFor(
			() => unsavedPrompt() ?? Promise.reject(new Error('no prompt')),
		);
		await fireEvent.click(within(prompt).getByRole('button', { name: /^cancel/ }));
		await settle();

		expect(unsavedPrompt(), 'a second, identical prompt followed the first').toBeNull();
		expect(h.destroyed).toBe(0);
	});

	it('asks once when ⌘W is pressed twice on one edited tab', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());

		commandRegistry.run('tab.close');
		commandRegistry.run('tab.close');
		const prompt = await vi.waitFor(
			() => unsavedPrompt() ?? Promise.reject(new Error('no prompt')),
		);
		await fireEvent.click(within(prompt).getByRole('button', { name: /^cancel/ }));
		await settle();

		expect(unsavedPrompt(), 'a second, identical prompt followed the first').toBeNull();
		expect(container.querySelector('.view-modes'), 'the tab stays open').not.toBeNull();
	});

	it('focuses the main button of a prompt that was waiting behind another', async () => {
		launchWithEdited('/w/a.json', '/w/b.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelectorAll('.view-modes')).toHaveLength(2));

		commandRegistry.run('tab.close');
		const first = await vi.waitFor(() => unsavedPrompt() ?? Promise.reject(new Error('no prompt')));
		commandRegistry.run('tab.prev');
		commandRegistry.run('tab.close');
		await settle();

		const cancel = within(first).getByRole('button', { name: /^cancel/ });
		cancel.focus();
		await fireEvent.click(cancel);
		await settle();

		const second = unsavedPrompt();
		expect(second?.textContent).toContain('a.json');
		expect(document.activeElement, 'focus stayed on the previous prompt’s cancel button').toBe(
			within(second!).getByRole('button', { name: /^save/ }),
		);
	});
});

describe('quitting', () => {
	const quit = async (button: RegExp) => {
		void h.onClose?.({ preventDefault: () => {} });
		const prompt = await vi.waitFor(
			() => unsavedPrompt() ?? Promise.reject(new Error('no prompt')),
		);
		await fireEvent.click(within(prompt).getByRole('button', { name: button }));
	};

	it('reopens a pasted document saved from the quit prompt at the next launch', async () => {
		const summary = {
			rootKind: 'object' as const,
			rootChildCount: 1,
			sourcePath: null,
			sourceSize: 7,
			lazy: false,
			version: 1,
			dirty: true,
			fileBacked: false,
			recoveryNote: null,
			commentsStripped: false,
			...SMALL_TIER,
		};
		vi.mocked(ipc.docOpen).mockResolvedValue({
			kind: 'opened',
			handle: 'pasted' as never,
			summary,
			notes: { convertedFrom: null, repairs: [] },
		});
		vi.mocked(saveDialog).mockResolvedValue('/w/saved.json');
		vi.mocked(ipc.docSave).mockResolvedValue({ path: '/w/saved.json', version: 1 });
		vi.mocked(ipc.docSummary).mockResolvedValue({
			...summary,
			sourcePath: '/w/saved.json',
			dirty: false,
			fileBacked: true,
		});
		const { container } = render(AppShell);
		await fireEvent.paste(container.querySelector('textarea')!, {
			clipboardData: { getData: () => '{"a":1}' },
		});
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		let tabsAtQuit: unknown;
		h.atDestroy = () =>
			(tabsAtQuit = vi
				.mocked(savePersisted)
				.mock.calls.findLast(([file]) => file === TABS_FILE)?.[2]);

		await quit(/^save/);
		await vi.waitFor(() => expect(h.destroyed).toBe(1));

		expect(tabsAtQuit).toEqual({ paths: ['/w/saved.json'], activeIndex: 0 });
	});

	it('closes the window only after the backup of discarded work is deleted', async () => {
		launchWithEdited('/w/a.json');
		const { container } = render(AppShell);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		let backupCleared!: () => void;
		vi.mocked(ipc.docBackupClear).mockImplementation(
			() => new Promise((r) => (backupCleared = () => r(null))),
		);

		await quit(/^don't save/);
		await vi.waitFor(() => expect(ipc.docBackupClear).toHaveBeenCalledWith('/w/a.json'));
		await settle();
		const destroyedBeforeCleared = h.destroyed;
		backupCleared();
		await settle();

		expect(destroyedBeforeCleared, 'the window closed while the backup still existed').toBe(0);
		expect(h.destroyed).toBe(1);
	});
});
