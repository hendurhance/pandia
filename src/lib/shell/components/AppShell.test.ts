// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { listen } from '@tauri-apps/api/event';
import { ipc } from '$lib/ipc/client';
import type { BackupRecord, OpenOutcome, OpenSource } from '$lib/ipc/bindings';
import { commandRegistry } from '$lib/palette/state/command-store.svelte';
import AppShell from './AppShell.svelte';

const h = vi.hoisted(() => ({
	settingsGate: null as Promise<void> | null,
	fns: {} as Record<string, ReturnType<typeof import('vitest').vi.fn>>,
	onClose: null as ((event: { preventDefault: () => void }) => Promise<void>) | null,
	destroyed: 0,
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
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(async () => ({ size: 10 })) }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
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

describe('restoring unsaved work after a crash', () => {
	const record: BackupRecord = {
		docId: 'old-doc',
		originalPath: '/w/notes.json',
		displayName: '/w/notes.json',
		updatedAt: '1',
		content: '{"draft":"unsaved words"}',
	};
	function restoredDoc(source: OpenSource): OpenOutcome {
		return {
			kind: 'opened',
			handle: 'restored' as never,
			summary: {
				rootKind: 'object',
				rootChildCount: 1,
				sourcePath: '/w/notes.json',
				sourceSize: record.content.length,
				lazy: false,
				version: 0,
				dirty: source.kind === 'text' && source.unsaved === true,
				fileBacked: false,
				recoveryNote: null,
				commentsStripped: false,
			},
			notes: { convertedFrom: null, repairs: [] },
		};
	}

	it('keeps the backup until the restored document has opened', async () => {
		vi.mocked(ipc.docBackupScan).mockResolvedValue([record]);
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
	});

	it('asks before closing a restored document that was never saved', async () => {
		vi.mocked(ipc.docBackupScan).mockResolvedValue([record]);
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
