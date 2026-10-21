// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { stat } from '@tauri-apps/plugin-fs';
import { ipc } from '$lib/ipc/client';
import { schemaSessions } from '$lib/panels/state/schema-store.svelte';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import type { PendingFile } from '$lib/ipc/bindings';
import type { DocStatus } from '$lib/shell/logic/status';
import { Handoff } from './handoff';
import { loadOpenTabs, saveOpenTabs } from './tabs-restore';
import { MAX_TABS, Workspace, type PaneView } from './workspace.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		cliWaitDone: vi.fn(async () => {}),
		cliDiscardPiped: vi.fn(async () => {}),
		cliReply: vi.fn(async () => {}),
		docBackupClear: vi.fn(async () => {}),
		docValidateSchema: vi.fn(),
	},
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(async () => ({ size: 10 })) }));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	SCHEMA_DEBOUNCE_MANUAL: -1,
	SCHEMA_DEBOUNCE_IMMEDIATE: 0,
	behaviorPrefs: {
		init: async () => {},
		schemaDebounceMs: 500,
		warnLargeFileOpen: true,
		autoSaveOnIdle: false,
		restoreTabsOnLaunch: true,
	},
}));
vi.mock('./tabs-restore', () => ({
	loadOpenTabs: vi.fn(async () => ({ paths: [], activeIndex: 0 })),
	saveOpenTabs: vi.fn(async () => {}),
}));

const LARGE = 300 * 1024 * 1024;

function prompts() {
	return {
		confirmLargeFile: vi.fn(async () => true),
		confirmUnsaved: vi.fn(async (): Promise<'save' | 'discard' | 'cancel'> => 'save'),
	};
}

function status(dirty: boolean): DocStatus {
	return {
		pathDisplay: null,
		kindDisplay: null,
		sizeDisplay: null,
		rootCountDisplay: null,
		lazy: false,
		validity: null,
		dirty,
	};
}

// Stands in for a mounted pane: what the Workspace reads from a tab.
function pane(
	ws: Workspace,
	tabId: string,
	opts: {
		dirty?: boolean;
		fileBacked?: boolean;
		path?: string;
		save?: () => Promise<boolean>;
	} = {},
) {
	const save = vi.fn(opts.save ?? (async () => true));
	const opened = ws.pendingOpens[tabId];
	const path = opts.path ?? (opened && 'path' in opened ? opened.path : `/w/${tabId}.json`);
	const view: PaneView = {
		label: `${tabId}.json`,
		sourceName: path,
		status: status(opts.dirty ?? false),
		context: {
			handle: `h-${tabId}` as never,
			version: 1,
			sourceName: path,
			fileBacked: opts.fileBacked ?? true,
			save,
		},
	};
	const unregister = ws.slot(tabId).register(view);
	return { save, unregister };
}

async function openTab(ws: Workspace, path: string): Promise<string> {
	const outcome = await ws.open({ kind: 'file', path });
	if (outcome.kind !== 'opened') throw new Error(`expected a tab, got ${outcome.kind}`);
	return outcome.tabId;
}

function waitingHandoff(path: string, wait: string): Handoff {
	const file: PendingFile = {
		path,
		piped: false,
		schema: null,
		compareWith: null,
		wait,
		reply: null,
	};
	return new Handoff(file);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(stat).mockResolvedValue({ size: 10 } as never);
	behaviorPrefs.autoSaveOnIdle = false;
	behaviorPrefs.restoreTabsOnLaunch = true;
});

describe('Workspace: panes', () => {
	it('lets a pane register from inside an effect, then follows its live state', () => {
		const ws = new Workspace(prompts());
		let name = $state('/w/a.json');
		let runs = 0;
		const view: PaneView = {
			get label() {
				return name.split('/').pop() ?? 'untitled';
			},
			get sourceName() {
				return name;
			},
			status: null,
			context: null,
		};
		const stop = $effect.root(() => {
			$effect(() => {
				runs += 1;
				return ws.slot('tab-1').register(view);
			});
		});
		flushSync();
		expect(runs).toBe(1);
		expect(ws.tabList[0]?.label).toBe('a.json');

		name = '/w/b.json';
		flushSync();
		expect(ws.tabList[0]?.label).toBe('b.json');
		expect(runs).toBe(1);
		stop();
	});
});

describe('Workspace: opening', () => {
	it('asks once about a large file, and cancelling opens nothing', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		vi.mocked(stat).mockResolvedValue({ size: LARGE } as never);
		p.confirmLargeFile.mockResolvedValue(false);

		expect(await ws.open({ kind: 'file', path: '/w/big.json' })).toEqual({ kind: 'declined' });
		expect(p.confirmLargeFile).toHaveBeenCalledTimes(1);
		expect(p.confirmLargeFile).toHaveBeenCalledWith('big.json', LARGE);
		expect(Object.values(ws.pendingOpens).filter(Boolean)).toHaveLength(0);
	});

	it('opens small files and text without asking', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		await openTab(ws, '/w/a.json');
		expect((await ws.open({ kind: 'text', text: '{}', name: 'x' })).kind).toBe('opened');
		expect(p.confirmLargeFile).not.toHaveBeenCalled();
	});

	it('reports when every tab is in use', async () => {
		const ws = new Workspace(prompts());
		for (let i = 0; i < MAX_TABS; i++) pane(ws, await openTab(ws, `/w/${i}.json`));
		expect(await ws.open({ kind: 'file', path: '/w/one-more.json' })).toEqual({ kind: 'full' });
	});

	it('reuses the empty active tab, unless its hand-off still owes a report', async () => {
		const ws = new Workspace(prompts());
		const first = (await ws.open(
			{ kind: 'file', path: '/w/missing.json' },
			{ handoff: waitingHandoff('/w/missing.json', '/tmp/pandia-wait-1') },
		)) as { tabId: string };
		const second = await openTab(ws, '/w/b.json');
		expect(second).not.toBe(first.tabId);
		expect(ws.slot(first.tabId).handoff?.waiting).toBe(true);

		const plain = new Workspace(prompts());
		expect(await openTab(plain, '/w/a.json')).toBe(plain.activeId);
	});

	it('gives each source its own tab while earlier ones are still opening', async () => {
		const ws = new Workspace(prompts());
		const ids = [
			await openTab(ws, '/w/a.json'),
			await openTab(ws, '/w/b.json'),
			((await ws.open({ kind: 'text', text: '{}', name: 'recovered.json' })) as { tabId: string })
				.tabId,
		];
		expect(new Set(ids).size).toBe(3);
		expect(ids.map((id) => ws.pendingOpens[id])).toEqual([
			{ kind: 'file', path: '/w/a.json' },
			{ kind: 'file', path: '/w/b.json' },
			{ kind: 'text', text: '{}', name: 'recovered.json' },
		]);
	});
});

describe('Workspace: closing a tab', () => {
	it('closes a clean tab without asking', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		const id = await openTab(ws, '/w/a.json');
		pane(ws, id);
		expect(await ws.close(id)).toBe(true);
		expect(p.confirmUnsaved).not.toHaveBeenCalled();
		expect(ws.tabs.map((t) => t.id)).not.toContain(id);
	});

	it('lets a pane ask about unsaved work before closing its document', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		const id = await openTab(ws, '/w/a.json');
		pane(ws, id, { dirty: false });
		expect(await ws.slot(id).resolveUnsaved()).toBe(true);
		expect(p.confirmUnsaved).not.toHaveBeenCalled();

		pane(ws, id, { dirty: true });
		p.confirmUnsaved.mockResolvedValue('cancel');
		expect(await ws.slot(id).resolveUnsaved()).toBe(false);
		expect(p.confirmUnsaved).toHaveBeenLastCalledWith(['a.json']);
		expect(ws.tabs.map((t) => t.id)).toContain(id);
	});

	it('saves a file-backed tab silently when auto-save is on', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		const id = await openTab(ws, '/w/a.json');
		const { save } = pane(ws, id, { dirty: true });
		behaviorPrefs.autoSaveOnIdle = true;
		expect(await ws.close(id)).toBe(true);
		expect(save).toHaveBeenCalledWith({ silent: true });
		expect(p.confirmUnsaved).not.toHaveBeenCalled();
	});

	it('asks about unsaved work: save, don’t save, or cancel', async () => {
		const p = prompts();
		const ws = new Workspace(p);

		const saved = await openTab(ws, '/w/a.json');
		const { save } = pane(ws, saved, { dirty: true });
		expect(await ws.close(saved)).toBe(true);
		expect(p.confirmUnsaved).toHaveBeenLastCalledWith(['a.json']);
		expect(save).toHaveBeenCalledWith();

		p.confirmUnsaved.mockResolvedValue('discard');
		const discarded = await openTab(ws, '/w/b.json');
		pane(ws, discarded, { dirty: true });
		expect(await ws.close(discarded)).toBe(true);
		expect(ipc.docBackupClear).toHaveBeenCalledWith(`h-${discarded}`);

		p.confirmUnsaved.mockResolvedValue('cancel');
		const kept = await openTab(ws, '/w/c.json');
		pane(ws, kept, { dirty: true });
		expect(await ws.close(kept)).toBe(false);
		expect(ws.tabs.map((t) => t.id)).toContain(kept);
	});

	it('keeps the tab when saving fails', async () => {
		const ws = new Workspace(prompts());
		const id = await openTab(ws, '/w/a.json');
		pane(ws, id, { dirty: true, save: async () => false });
		expect(await ws.close(id)).toBe(false);
		expect(ws.tabs.map((t) => t.id)).toContain(id);
	});

	it('reports the final verdict while the tab is still open, then removes the tab', async () => {
		const ws = new Workspace(prompts());
		const handoff = waitingHandoff('/w/a.json', '/tmp/pandia-wait-2');
		const outcome = (await ws.open({ kind: 'file', path: '/w/a.json' }, { handoff })) as {
			tabId: string;
		};
		const id = outcome.tabId;
		pane(ws, id);
		handoff.opened();
		const schema = schemaSessions.for(id);
		schema.documentChanged('h' as never, 1);
		vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce({
			valid: true,
			errors: [],
			errorCount: 0,
			truncated: false,
		});
		await schema.load('{"type":"object"}', null);
		schema.documentChanged('h' as never, 2);
		vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce({
			valid: false,
			errors: [],
			errorCount: 3,
			truncated: false,
		});
		let openWhileReporting = false;
		vi.mocked(ipc.cliWaitDone).mockImplementationOnce(async () => {
			openWhileReporting = ws.tabs.some((t) => t.id === id);
		});

		await ws.close(id);
		expect(vi.mocked(ipc.cliWaitDone).mock.calls[0]?.[1]).toMatchObject({
			valid: false,
			errorCount: 3,
		});
		expect(openWhileReporting).toBe(true);
		expect(ws.tabs.map((t) => t.id)).not.toContain(id);
		expect(schemaSessions.existing(id)).toBeNull();
	});

	it('stops answering for a tab once it closes', async () => {
		const ws = new Workspace(prompts());
		const a = await openTab(ws, '/w/a.json');
		pane(ws, a);
		const b = await ws.open({ kind: 'file', path: '/w/b.json' }, { focus: false });
		expect(ws.slot((b as { tabId: string }).tabId).isHandleAlive(`h-${a}` as never)).toBe(true);
		await ws.close(a);
		expect(ws.slot((b as { tabId: string }).tabId).isHandleAlive(`h-${a}` as never)).toBe(false);
	});
});

describe('Workspace: closing the window', () => {
	it('asks once for every unsaved tab and saves them all', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		const a = await openTab(ws, '/w/a.json');
		const pa = pane(ws, a, { dirty: true });
		const b = (await ws.open({ kind: 'file', path: '/w/b.json' }, { focus: false })) as {
			tabId: string;
		};
		const pb = pane(ws, b.tabId, { dirty: true });

		expect(await ws.closeAll()).toBe(true);
		expect(p.confirmUnsaved).toHaveBeenCalledTimes(1);
		expect(p.confirmUnsaved).toHaveBeenCalledWith(['a.json', 'b.json']);
		expect(pa.save).toHaveBeenCalled();
		expect(pb.save).toHaveBeenCalled();
	});

	it('stops at the first save that fails', async () => {
		const ws = new Workspace(prompts());
		const a = await openTab(ws, '/w/a.json');
		pane(ws, a, { dirty: true, save: async () => false });
		const b = (await ws.open({ kind: 'file', path: '/w/b.json' }, { focus: false })) as {
			tabId: string;
		};
		const pb = pane(ws, b.tabId, { dirty: true });
		expect(await ws.closeAll()).toBe(false);
		expect(pb.save).not.toHaveBeenCalled();
	});

	it('applies the auto-save rule before asking', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		behaviorPrefs.autoSaveOnIdle = true;
		const a = await openTab(ws, '/w/a.json');
		pane(ws, a, { dirty: true });
		const b = (await ws.open({ kind: 'text', text: '{}', name: 'pasted' }, { focus: false })) as {
			tabId: string;
		};
		pane(ws, b.tabId, { dirty: true, fileBacked: false, path: 'pasted' });
		await ws.closeAll();
		expect(p.confirmUnsaved).toHaveBeenCalledWith(['pasted']);
	});

	it('settles every hand-off', async () => {
		const ws = new Workspace(prompts());
		await ws.open(
			{ kind: 'file', path: '/w/a.json' },
			{ handoff: waitingHandoff('/w/a.json', '/tmp/pandia-wait-3') },
		);
		await ws.open(
			{ kind: 'file', path: '/w/b.json' },
			{ handoff: waitingHandoff('/w/b.json', '/tmp/pandia-wait-4') },
		);
		expect(await ws.closeAll()).toBe(true);
		expect(ipc.cliWaitDone).toHaveBeenCalledTimes(2);
	});
});

describe('Workspace: restoring tabs', () => {
	it('reopens the saved tabs, asking about large ones, and activates the saved tab', async () => {
		const p = prompts();
		const ws = new Workspace(p);
		vi.mocked(loadOpenTabs).mockResolvedValue({
			paths: ['/w/a.json', '/w/big.json', '/w/c.json'],
			activeIndex: 2,
		});
		vi.mocked(stat).mockImplementation(
			async (path) => ({ size: String(path).includes('big') ? LARGE : 10 }) as never,
		);
		p.confirmLargeFile.mockResolvedValue(false);

		await ws.restore(Promise.resolve());
		const opened = Object.values(ws.pendingOpens).map((s) => (s && 'path' in s ? s.path : null));
		expect(opened).toEqual(['/w/a.json', '/w/c.json']);
		expect(ws.activeId).toBe(ws.tabs[1]?.id);
	});

	it('waits for files handed in at launch, then skips restoring', async () => {
		const ws = new Workspace(prompts());
		vi.mocked(loadOpenTabs).mockResolvedValue({ paths: ['/w/old.json'], activeIndex: 0 });
		let statDone!: () => void;
		vi.mocked(stat).mockImplementationOnce(
			() => new Promise((r) => (statDone = () => r({ size: 10 } as never))),
		);
		const launch = openTab(ws, '/w/from-cli.json').then(() => {});
		const restoring = ws.restore(launch);
		await vi.waitFor(() => expect(statDone).toBeDefined());
		await new Promise((r) => setTimeout(r, 0)); // let restore read the saved tabs first
		statDone();
		await Promise.all([launch, restoring]);
		expect(Object.values(ws.pendingOpens).filter(Boolean)).toEqual([
			{ kind: 'file', path: '/w/from-cli.json' },
		]);
	});

	it('skips restoring when a launch already queued files', async () => {
		const ws = new Workspace(prompts());
		await openTab(ws, '/w/from-cli.json');
		vi.mocked(loadOpenTabs).mockResolvedValue({ paths: ['/w/old.json'], activeIndex: 0 });
		await ws.restore(Promise.resolve());
		expect(ws.tabs).toHaveLength(1);
	});

	it('saves only file-backed tabs, with the active one marked', async () => {
		const ws = new Workspace(prompts());
		const a = await openTab(ws, '/w/a.json');
		pane(ws, a);
		const b = (await ws.open({ kind: 'text', text: '{}', name: 'pasted' })) as { tabId: string };
		pane(ws, b.tabId, { fileBacked: false, path: 'pasted' });
		await ws.snapshot();
		expect(saveOpenTabs).toHaveBeenCalledWith(['/w/a.json'], -1);
		ws.activate(a);
		await ws.snapshot();
		expect(saveOpenTabs).toHaveBeenLastCalledWith(['/w/a.json'], 0);
	});
});
