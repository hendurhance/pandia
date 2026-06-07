<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { open as openDialog, message, ask } from '@tauri-apps/plugin-dialog';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';
	import { check } from '@tauri-apps/plugin-updater';
	import { relaunch } from '@tauri-apps/plugin-process';
	import { getVersion } from '@tauri-apps/api/app';
	import { clearRecents, recentsStore } from '$lib/shell/state/recents-store.svelte';
	import { updateCheck } from '$lib/shell/state/update-check.svelte';
	import { loadOpenTabs, saveOpenTabs } from '$lib/shell/state/tabs-restore';
	import CommandPalette from '$lib/palette/CommandPalette.svelte';
	import { commandRegistry } from '$lib/palette/state/command-store.svelte';
	import {
		buildShellCommands,
		buildMenuRouteMap,
		type ShellCommandDeps,
	} from '$lib/shell/logic/app-commands';
	import DocPane from '$lib/docpane/components/DocPane.svelte';
	import HelpDialog from '$lib/shell/components/HelpDialog.svelte';
	import SettingsView from '$lib/settings/SettingsView.svelte';
	import Sidebar from './Sidebar.svelte';
	import StatusBar from './StatusBar.svelte';
	import RecoveryDialog from './RecoveryDialog.svelte';
	import ComparePicker from './ComparePicker.svelte';
	import TabBar from '$lib/shell/components/TabBar.svelte';
	import { TabStore, MAX_TABS } from '$lib/shell/state/tab-store.svelte';
	import { sidebarPrefs } from '../state/sidebar-prefs.svelte';
	import { docBackupScan, docBackupClear } from '$lib/ipc/doc';
	import type { BackupRecord, Path } from '$lib/ipc/types';
	import type { CompareTarget } from '$lib/views/compare/logic/compare-target';
	import { ConfirmController } from '$lib/ui/confirm.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
	import { basename } from '$lib/util/path';
	import { stat } from '@tauri-apps/plugin-fs';
	import { fmtBytes } from '$lib/util/format';

	const LARGE_FILE_WARN_BYTES = 200 * 1024 * 1024;

	const tabStore = new TabStore();
	const confirm = new ConfirmController();

	async function maybeConfirmLargeFile(path: string): Promise<boolean> {
		if (!behaviorPrefs.warnLargeFileOpen) return true;
		let size = 0;
		try {
			const info = await stat(path);
			size = Number(info.size ?? 0);
		} catch {
			return true; // stat failed — let the open attempt its own error path
		}
		if (size < LARGE_FILE_WARN_BYTES) return true;
		const choice = await confirm.ask({
			title: 'large file',
			message: `${basename(path)} is ${fmtBytes(size)}. Opening will work but validation, diff, and export may be slow at this size.`,
			primaryLabel: 'open anyway',
			secondaryLabel: 'cancel',
			cancelLabel: 'cancel',
		});
		return choice === 'primary';
	}

	async function requestCloseTab(id: string): Promise<boolean> {
		const status = tabStore.statuses[id];
		const ctx = tabStore.contexts[id];
		const dirty = status?.dirty ?? false;
		if (!dirty) {
			tabStore.close(id);
			return true;
		}
		if (behaviorPrefs.autoSaveOnIdle && ctx?.fileBacked && ctx) {
			const ok = await ctx.save({ silent: true });
			if (!ok) return false;
			tabStore.close(id);
			return true;
		}
		tabStore.activate(id);
		const name = ctx?.sourceName ? basename(ctx.sourceName) : 'untitled';
		const choice = await confirm.ask({
			title: 'unsaved changes',
			message: `Do you want to save the changes you made to ${name}?\nYour changes will be lost if you don't save them.`,
			primaryLabel: 'save',
			secondaryLabel: "don't save",
		});
		if (choice === 'cancel') return false;
		if (choice === 'primary') {
			if (!ctx) return false;
			const ok = await ctx.save();
			if (!ok) return false;
		} else if (choice === 'secondary' && ctx) {
			void docBackupClear(ctx.handle).catch(() => {});
		}
		tabStore.close(id);
		return true;
	}

	let navRequest: { path: Path; nonce: number; tabId: string } | null = $state(null);
	let historyRequest: { delta: number; nonce: number; tabId: string } | null = $state(null);
	let compareRequest: { target: CompareTarget; nonce: number; tabId: string } | null = $state(null);
	let actionNonce = 0;
	function requestNavigate(path: Path) {
		navRequest = { path, nonce: ++actionNonce, tabId: tabStore.activeId };
	}
	function requestHistoryStep(delta: number) {
		historyRequest = { delta, nonce: ++actionNonce, tabId: tabStore.activeId };
	}

	let comparePickerOpen = $state(false);
	let compareBtnEl: HTMLElement | null = $state(null); // the Compare button (dismiss ignores its clicks)
	function toggleComparePicker() {
		if (!tabStore.activeContext) return;
		comparePickerOpen = !comparePickerOpen;
	}
	function requestCompare(target: CompareTarget) {
		compareRequest = { target, nonce: ++actionNonce, tabId: tabStore.activeId };
		comparePickerOpen = false;
	}

	async function cmdOpenFile() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: [{ name: 'JSON', extensions: ['json', 'jsonc', 'json5', 'geojson'] }],
		});
		if (typeof picked !== 'string') return;
		if (!(await maybeConfirmLargeFile(picked))) return;
		tabStore.openInTab({ kind: 'file', path: picked });
	}

	const shellCommandDeps: ShellCommandDeps = {
		tabsLength: () => tabStore.tabs.length,
		activeTabId: () => tabStore.activeId,
		hasActiveContext: () => !!tabStore.activeContext,
		newTab: tabStore.create,
		requestCloseTab,
		nextTab: tabStore.next,
		prevTab: tabStore.prev,
		openFile: cmdOpenFile,
		openInTab: (source) => tabStore.openInTab(source),
		toggleSidebar: () => sidebarPrefs.toggleCollapsed(),
		revealSchemaPanel: () => {
			if (sidebarPrefs.collapsed) sidebarPrefs.toggleCollapsed();
			sidebarPrefs.setActiveTab('schema');
		},
		toggleComparePicker,
		openSettings: () => {
			settingsOpen = true;
		},
		openHelp: () => {
			helpOpen = true;
		},
		togglePalette,
		clearRecents,
		showAbout,
		checkForUpdates,
		openWebsite: () => void openInBrowser('https://www.pandia.app').catch(() => {}),
		reportIssue: () =>
			void openInBrowser('https://github.com/hendurhance/pandia/issues/new').catch(() => {}),
		isDev: import.meta.env.DEV,
	};

	$effect(() => {
		const cmds = buildShellCommands(shellCommandDeps);
		const dispose = cmds.map((c) => commandRegistry.register(c));
		return () => {
			for (const d of dispose) d();
		};
	});

	let recovery: BackupRecord[] = $state([]);
	$effect(() => {
		let cancelled = false;
		void docBackupScan()
			.then((recs) => {
				if (!cancelled) recovery = recs;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	function restoreOne(rec: BackupRecord) {
		const name = rec.displayName ?? 'recovered.json';
		tabStore.openInTab({ kind: 'text', text: rec.content, name });
		void docBackupClear(rec.docId).catch(() => {});
		recovery = recovery.filter((r) => r.docId !== rec.docId);
	}

	function restoreAll() {
		for (const rec of [...recovery]) restoreOne(rec);
	}

	function discardRecovery() {
		for (const rec of recovery) void docBackupClear(rec.docId).catch(() => {});
		recovery = [];
	}

	async function snapshotOpenTabs(): Promise<void> {
		if (!behaviorPrefs.restoreTabsOnLaunch) return;
		const filePaths: string[] = [];
		let activeIndex = -1;
		for (const tab of tabStore.tabs) {
			const ctx = tabStore.contexts[tab.id];
			if (!ctx?.fileBacked || !ctx.sourceName) continue;
			if (tab.id === tabStore.activeId) activeIndex = filePaths.length;
			filePaths.push(ctx.sourceName);
		}
		await saveOpenTabs(filePaths, activeIndex);
	}

	let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void tabStore.tabs;
		void tabStore.activeId;
		void tabStore.contexts;
		if (snapshotTimer) clearTimeout(snapshotTimer);
		snapshotTimer = setTimeout(() => void snapshotOpenTabs(), 250);
		return () => {
			if (snapshotTimer) clearTimeout(snapshotTimer);
		};
	});

	$effect(() => {
		let unlisten: (() => void) | null = null;
		let cancelled = false;
		const win = getCurrentWebviewWindow();
		void win
			.onCloseRequested(async (event) => {
				event.preventDefault();
				await snapshotOpenTabs();
				const dirtyTabs = tabStore.tabs.filter((t) => tabStore.statuses[t.id]?.dirty);
				if (dirtyTabs.length > 0) {
					const n = dirtyTabs.length;
					const choice = await confirm.ask({
						title: 'unsaved changes',
						message:
							n === 1
								? `You have unsaved changes in ${basename(tabStore.contexts[dirtyTabs[0].id]?.sourceName ?? dirtyTabs[0].label)}.\nYour changes will be lost if you don't save them.`
								: `You have unsaved changes in ${n} documents.\nYour changes will be lost if you don't save them.`,
						primaryLabel: n === 1 ? 'save' : 'save all',
						secondaryLabel: "don't save",
					});
					if (choice === 'cancel') return;
					if (choice === 'primary') {
						for (const t of dirtyTabs) {
							const ctx = tabStore.contexts[t.id];
							if (!ctx) continue;
							tabStore.activate(t.id); // surface which doc the save-as dialog is for
							const ok = await ctx.save();
							if (!ok) return; // save failed (parse error / cancelled Save As) — abort quit
						}
					} else {
						for (const t of dirtyTabs) {
							const ctx = tabStore.contexts[t.id];
							if (ctx) void docBackupClear(ctx.handle).catch(() => {});
						}
					}
				}
				await win.destroy();
			})
			.then((u) => {
				if (cancelled) u();
				else unlisten = u;
			});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	let dropping = $state(false);
	let dropHint: string | null = $state(null);

	$effect(() => {
		let unlisten: (() => void) | null = null;
		let cancelled = false;
		const win = getCurrentWebviewWindow();
		void win
			.onDragDropEvent((e) => {
				const p = e.payload;
				if (p.type === 'enter') {
					dropping = true;
					const n = p.paths.length;
					dropHint = n > 1 ? `drop to open ${n} files` : 'drop to open';
				} else if (p.type === 'over') {
					dropping = true;
				} else if (p.type === 'drop') {
					dropping = false;
					dropHint = null;
					void (async () => {
						for (const path of p.paths) {
							if (!(await maybeConfirmLargeFile(path))) continue;
							const ok = tabStore.openInTab({ kind: 'file', path });
							if (!ok) break;
						}
					})();
				} else if (p.type === 'leave') {
					dropping = false;
					dropHint = null;
				}
			})
			.then((u) => {
				if (cancelled) u();
				else unlisten = u;
			});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	let helpOpen = $state(false);
	let settingsOpen = $state(false);

	let paletteOpen = $state(false);
	function openPalette() {
		paletteOpen = true;
	}
	function closePalette() {
		paletteOpen = false;
	}
	function togglePalette() {
		paletteOpen = !paletteOpen;
	}

	async function showAbout() {
		const v = await getVersion().catch(() => '');
		await message(`Pandia${v ? ` ${v}` : ''}\n\nA privacy-first desktop JSON IDE.`, {
			title: 'About Pandia',
		});
	}

	async function checkForUpdates() {
		try {
			const update = await check();
			if (update) {
				const yes = await ask(`Pandia ${update.version} is available. Download and install now?`, {
					title: 'Update available',
				});
				if (yes) {
					await update.downloadAndInstall();
					await relaunch();
				}
			} else {
				await message("You're up to date.", { title: 'Pandia' });
			}
		} catch (e) {
			await message(`Couldn't check for updates.\n\n${e}`, { title: 'Pandia', kind: 'warning' });
		}
	}

	$effect(() => {
		const items = recentsStore.list.slice(0, 12).map((r) => ({ path: r.path, name: r.name }));
		void invoke('refresh_recent_files', { items });
	});

	$effect(() => {
		const t = setTimeout(() => void updateCheck.silentCheck(), 10000);
		return () => clearTimeout(t);
	});

	// Restore file-backed tabs from the previous session if the user opted in.
	// Runs once on mount, after behavior prefs have loaded. Skipped when the
	// app was launched with files (CLI args / Finder open / pending queue) so
	// we don't fight the requested-file flow.
	$effect(() => {
		let cancelled = false;
		void (async () => {
			await behaviorPrefs.init();
			if (cancelled || !behaviorPrefs.restoreTabsOnLaunch) return;
			const { paths, activeIndex } = await loadOpenTabs();
			if (cancelled || paths.length === 0) return;
			const anyContext = Object.values(tabStore.contexts).some((c) => c != null);
			const anyPending = Object.values(tabStore.pendingOpens).some((p) => p != null);
			if (anyContext || anyPending) return;
			for (let i = 0; i < paths.length; i++) {
				const ok = tabStore.openInTab({ kind: 'file', path: paths[i] }, { focus: i === 0 });
				if (!ok) break;
			}
			if (activeIndex > 0 && activeIndex < tabStore.tabs.length) {
				tabStore.activate(tabStore.tabs[activeIndex].id);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	async function drainPendingFiles() {
		let paths: string[] = [];
		try {
			paths = await invoke<string[]>('drain_pending_files');
		} catch {
			return;
		}
		for (const path of paths) {
			if (!(await maybeConfirmLargeFile(path))) continue;
			const ok = tabStore.openInTab({ kind: 'file', path });
			if (!ok) break;
		}
	}

	$effect(() => {
		let unlisten: UnlistenFn | null = null;
		let cancelled = false;
		listen('file-open', () => {
			void drainPendingFiles();
		}).then((fn) => {
			if (cancelled) fn();
			else unlisten = fn;
		});
		void drainPendingFiles();
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	$effect(() => {
		let unlisten: UnlistenFn | null = null;
		let cancelled = false;
		const menuRoutes = buildMenuRouteMap(shellCommandDeps);
		listen<string>('menu-event', (e) => {
			const id = e.payload;
			if (id.startsWith('recent::')) {
				const path = id.slice('recent::'.length);
				void (async () => {
					if (await maybeConfirmLargeFile(path)) tabStore.openInTab({ kind: 'file', path });
				})();
			} else {
				menuRoutes[id]?.();
			}
		}).then((fn) => {
			if (cancelled) fn();
			else unlisten = fn;
		});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	function onTopBarPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (
			target?.closest(
				'button, input, select, a, [role="button"], [role="tab"], [data-tab-id], [data-no-drag]',
			)
		)
			return;
		const win = getCurrentWebviewWindow();
		void win.startDragging().catch(() => {});
	}
</script>

<div class="shell">
	<header
		class="shell-top"
		role="toolbar"
		aria-label="Window top bar"
		tabindex="-1"
		onpointerdown={onTopBarPointerDown}
	>
		<TabBar
			tabs={tabStore.tabs}
			activeTabId={tabStore.activeId}
			tabStatuses={tabStore.statuses}
			capWarning={tabStore.capWarning}
			maxTabs={MAX_TABS}
			hasActiveDoc={!!tabStore.activeContext}
			{comparePickerOpen}
			bind:compareBtnEl
			onActivate={tabStore.activate}
			onClose={(id) => void requestCloseTab(id)}
			onNew={tabStore.create}
			onReorder={tabStore.reorder}
			onToggleCompare={toggleComparePicker}
			onExport={() => commandRegistry.get('doc.export')?.run()}
		/>
	</header>

	<div class="shell-body">
		{#snippet sidebarPanel()}
			<Sidebar
				activeTabId={tabStore.activeId}
				activeContext={tabStore.activeContext}
				onNavigate={requestNavigate}
				onHistoryStep={requestHistoryStep}
			/>
		{/snippet}

		{#if sidebarPrefs.loaded && !sidebarPrefs.collapsed && sidebarPrefs.side === 'left'}
			{@render sidebarPanel()}
		{/if}

		<main class="shell-main">
			{#each tabStore.tabs as tab (tab.id)}
				<div class="pane-host" class:active={tab.id === tabStore.activeId}>
					<DocPane
						tabId={tab.id}
						isActive={tab.id === tabStore.activeId}
						onLabelChange={(label) => tabStore.setLabel(tab.id, label)}
						onStatusChange={(status) => tabStore.setStatus(tab.id, status)}
						pendingOpen={tabStore.pendingOpens[tab.id] ?? null}
						onOpened={() => tabStore.clearPendingOpen(tab.id)}
						onOpenInNewTab={tabStore.openInTab}
						onContextChange={(ctx) => tabStore.setContext(tab.id, ctx)}
						isHandleAlive={(h) => Object.values(tabStore.contexts).some((c) => c?.handle === h)}
						confirmLargeFile={maybeConfirmLargeFile}
						{navRequest}
						{historyRequest}
						{compareRequest}
					/>
				</div>
			{/each}
		</main>

		{#if sidebarPrefs.loaded && !sidebarPrefs.collapsed && sidebarPrefs.side === 'right'}
			{@render sidebarPanel()}
		{/if}
	</div>

	<footer class="shell-status">
		<StatusBar status={tabStore.activeStatus} onPaletteOpen={openPalette} />
	</footer>

	{#if dropping}
		<div class="drop-overlay" aria-hidden="true">
			<div class="drop-hint">{dropHint ?? 'drop to open'}</div>
		</div>
	{/if}

	{#if recovery.length > 0}
		<RecoveryDialog
			records={recovery}
			onRestore={restoreOne}
			onRestoreAll={restoreAll}
			onDiscard={discardRecovery}
		/>
	{/if}

	{#if confirm.state}
		<ConfirmDialog
			title={confirm.state.title}
			message={confirm.state.message}
			primaryLabel={confirm.state.primaryLabel}
			secondaryLabel={confirm.state.secondaryLabel}
			cancelLabel={confirm.state.cancelLabel}
			dangerPrimary={confirm.state.dangerPrimary}
			onPick={confirm.pick}
		/>
	{/if}

	{#if comparePickerOpen}
		<ComparePicker
			candidates={tabStore.compareCandidates}
			anchorEl={compareBtnEl}
			onPick={requestCompare}
			onDismiss={() => (comparePickerOpen = false)}
		/>
	{/if}
</div>

<CommandPalette open={paletteOpen} onClose={closePalette} />

{#if helpOpen}
	<HelpDialog onClose={() => (helpOpen = false)} />
{/if}

{#if settingsOpen}
	<div class="settings-overlay">
		<SettingsView onClose={() => (settingsOpen = false)} />
	</div>
{/if}

<style>
	.shell {
		display: grid;
		grid-template-rows: auto 1fr auto;

		grid-template-columns: minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}

	.shell-top {
		border-bottom: var(--rule-width) solid var(--rule);
		background: var(--bg);
	}

	:global([data-platform='mac']) .shell-top {
		padding-left: 78px;
		-webkit-app-region: drag;
	}

	.shell-body {
		display: flex;
		flex-direction: row;
		min-height: 0;
		min-width: 0;
	}

	.shell-main {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}

	.pane-host {
		display: none;
		min-width: 0;
		min-height: 0;
	}
	.pane-host.active {
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.shell {
		position: relative;
	}
	.drop-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		border: 2px dashed var(--accent);
		pointer-events: none;
		z-index: 50;
	}
	.drop-hint {
		padding: 0.5rem 1rem;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--accent);
		color: var(--accent);
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}

	.settings-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--bg);
	}
</style>
