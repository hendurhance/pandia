<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { open as openDialog, message } from '@tauri-apps/plugin-dialog';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';
	import { check } from '@tauri-apps/plugin-updater';
	import { getVersion } from '@tauri-apps/api/app';
	import { clearRecents, recentsStore } from '$lib/shell/state/recents-store.svelte';
	import { updateCheck } from '$lib/shell/state/update-check.svelte';
	import { whatsNew } from '$lib/shell/state/whats-new.svelte';
	import { SANDBOX_ENABLED } from '$lib/util/flags';
	import { JSON_OPEN_FILTERS } from '$lib/util/file-types';
	import { describeError } from '$lib/ipc/error-copy';
	import CommandPalette from '$lib/palette/CommandPalette.svelte';
	import { commandRegistry } from '$lib/palette/state/command-store.svelte';
	import { buildShellCommands, type ShellCommandDeps } from '$lib/shell/logic/app-commands';
	import { matchShortcut } from '$lib/shell/logic/shortcuts';
	import DocPane from '$lib/docpane/components/DocPane.svelte';
	import HelpDialog from '$lib/shell/components/HelpDialog.svelte';
	import FeedbackDialog from '$lib/shell/components/FeedbackDialog.svelte';
	import UpdateDialog from '$lib/shell/components/UpdateDialog.svelte';
	import WhatsNewDialog from '$lib/shell/components/WhatsNewDialog.svelte';
	import SettingsView from '$lib/settings/SettingsView.svelte';
	import type { SettingsTab } from '$lib/settings/tabs';
	import Sidebar from './Sidebar.svelte';
	import StatusBar from './StatusBar.svelte';
	import RecoveryDialog from './RecoveryDialog.svelte';
	import ComparePicker from './ComparePicker.svelte';
	import TabBar from '$lib/shell/components/TabBar.svelte';
	import { MAX_TABS, Workspace } from '$lib/shell/state/workspace.svelte';
	import { sidebarPrefs } from '../state/sidebar-prefs.svelte';
	import { ipc } from '$lib/ipc/client';
	import type { BackupRecord, OpenSource, Path, PendingFile } from '$lib/ipc/bindings';
	import { Handoff } from '$lib/shell/state/handoff';
	import type { CompareTarget } from '$lib/views/compare/logic/compare-target';
	import { PaneCommandBus } from '$lib/shell/state/pane-bus';
	import { ConfirmController } from '$lib/ui/confirm.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import { fmtBytes } from '$lib/util/format';

	const FEEDBACK_URL = 'https://tally.so/r/dW419D';

	const confirm = new ConfirmController();
	const workspace = new Workspace({ confirmLargeFile, confirmUnsaved });

	async function confirmLargeFile(name: string, bytes: number): Promise<boolean> {
		const choice = await confirm.ask({
			title: 'large file',
			message: `${name} is ${fmtBytes(bytes)}. Opening will work but validation, diff, and export may be slow at this size.`,
			primaryLabel: 'open anyway',
			secondaryLabel: 'cancel',
			cancelLabel: 'cancel',
		});
		return choice === 'primary';
	}

	async function confirmUnsaved(names: string[]): Promise<'save' | 'discard' | 'cancel'> {
		const [only] = names;
		const one = names.length === 1 && only !== undefined;
		const choice = await confirm.ask({
			title: 'unsaved changes',
			message: one
				? `Do you want to save the changes you made to ${only}?\nYour changes will be lost if you don't save them.`
				: `You have unsaved changes in ${names.length} documents.\nYour changes will be lost if you don't save them.`,
			primaryLabel: one ? 'save' : 'save all',
			secondaryLabel: "don't save",
		});
		return choice === 'primary' ? 'save' : choice === 'secondary' ? 'discard' : 'cancel';
	}

	async function confirmCommentLoss(name: string): Promise<'save' | 'saveAs' | 'cancel'> {
		const choice = await confirm.ask({
			title: 'comments will be lost',
			message: `Pandia removed the comments in ${name} to read it as JSON. Saving overwrites the file without them. Save As keeps the original file untouched.`,
			primaryLabel: 'save without comments',
			secondaryLabel: 'save as…',
			dangerPrimary: true,
		});
		return choice === 'primary' ? 'save' : choice === 'secondary' ? 'saveAs' : 'cancel';
	}

	async function confirmSchemaFetch(host: string): Promise<boolean> {
		const choice = await confirm.ask({
			title: 'load schema from the internet?',
			message: `This document's $schema points to ${host}. Loading it downloads the schema from that server.`,
			primaryLabel: 'load schema',
			cancelLabel: "don't load",
		});
		return choice === 'primary';
	}

	const paneBus = new PaneCommandBus();
	function requestNavigate(path: Path) {
		paneBus.dispatch(workspace.activeId, { kind: 'navigate', path });
	}
	function requestHistoryStep(delta: number) {
		paneBus.dispatch(workspace.activeId, { kind: 'history', delta });
	}

	let comparePickerOpen = $state(false);
	let compareBtnEl: HTMLElement | null = $state(null); // the Compare button (dismiss ignores its clicks)
	function toggleComparePicker() {
		if (!workspace.activeContext) return;
		comparePickerOpen = !comparePickerOpen;
	}
	function requestCompare(target: CompareTarget) {
		paneBus.dispatch(workspace.activeId, { kind: 'compare', target });
		comparePickerOpen = false;
	}

	async function cmdOpenFile() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: JSON_OPEN_FILTERS,
		});
		if (typeof picked !== 'string') return;
		await workspace.open({ kind: 'file', path: picked });
	}

	const shellCommandDeps: ShellCommandDeps = {
		tabsLength: () => workspace.tabs.length,
		activeTabId: () => workspace.activeId,
		hasActiveContext: () => !!workspace.activeContext,
		newTab: workspace.create,
		requestCloseTab: (id) => void workspace.close(id),
		nextTab: workspace.next,
		prevTab: workspace.prev,
		openFile: cmdOpenFile,
		openInTab: (source) => void workspace.open(source),
		toggleSidebar: () => sidebarPrefs.toggleCollapsed(),
		revealSchemaPanel: () => {
			if (sidebarPrefs.collapsed) sidebarPrefs.toggleCollapsed();
			sidebarPrefs.setActiveTab('schema');
		},
		toggleComparePicker,
		openSettings: (tab: SettingsTab = 'appearance') => {
			settingsTab = tab;
		},
		openHelp: () => {
			helpOpen = true;
		},
		openWhatsNew: () => {
			whatsNewOpen = true;
		},
		openFeedback: () => {
			feedbackOpen = true;
		},
		togglePalette,
		clearRecents,
		showAbout,
		checkForUpdates,
		openWebsite: () => void openInBrowser('https://www.pandia.app').catch(() => {}),
		openDiscussions: () =>
			void openInBrowser('https://github.com/hendurhance/pandia/discussions').catch(() => {}),
		reportIssue: () =>
			void openInBrowser('https://github.com/hendurhance/pandia/issues/new/choose').catch(() => {}),
		isDev: SANDBOX_ENABLED,
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
		void ipc
			.docBackupScan()
			.then((recs) => {
				if (!cancelled) recovery = recs;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	async function restoreOne(rec: BackupRecord) {
		const name = rec.displayName ?? 'recovered.json';
		const outcome = await workspace.open({ kind: 'text', text: rec.content, name });
		if (outcome.kind !== 'opened') return;
		void ipc.docBackupClear(rec.docId).catch(() => {});
		recovery = recovery.filter((r) => r.docId !== rec.docId);
	}

	async function restoreAll() {
		for (const rec of [...recovery]) await restoreOne(rec);
	}

	function discardRecovery() {
		for (const rec of recovery) void ipc.docBackupClear(rec.docId).catch(() => {});
		recovery = [];
	}

	let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void workspace.tabList;
		void workspace.activeId;
		if (snapshotTimer) clearTimeout(snapshotTimer);
		snapshotTimer = setTimeout(() => void workspace.snapshot(), 250);
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
				let shouldClose = true;
				try {
					await workspace.snapshot();
					shouldClose = await workspace.closeAll();
				} finally {
					if (shouldClose) await win.destroy();
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
							if ((await workspace.open({ kind: 'file', path })).kind === 'full') break;
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
	let whatsNewOpen = $state(false);
	let feedbackOpen = $state(false);
	let settingsTab: SettingsTab | null = $state(null);

	function shareFeedback() {
		feedbackOpen = false;
		void openInBrowser(FEEDBACK_URL).catch(() => {});
	}

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
				updateCheck.offer(update);
			} else {
				await message("You're up to date.", { title: 'Pandia' });
			}
		} catch (e) {
			await message(`Couldn't check for updates.\n\n${describeError(e)}`, {
				title: 'Pandia',
				kind: 'warning',
			});
		}
	}

	$effect(() => {
		const items = recentsStore.list.slice(0, 12).map((r) => ({ path: r.path, name: r.name }));
		void ipc.refreshRecentFiles(items);
	});

	$effect(() => {
		const t = setTimeout(() => void updateCheck.silentCheck(), 10000);
		return () => clearTimeout(t);
	});

	$effect(() => {
		void whatsNew.init().catch(() => {});
	});

	async function drainPendingFiles() {
		let pending: PendingFile[] = [];
		try {
			pending = await ipc.drainPendingFiles();
		} catch {
			return;
		}
		for (const file of pending) {
			const { path, piped } = file;
			const handoff = Handoff.needed(file) ? new Handoff(file) : null;
			const source: OpenSource = piped ? { kind: 'piped', path } : { kind: 'file', path };
			const outcome = await workspace.open(source, { handoff });
			if (outcome.kind === 'declined') {
				void handoff?.abandon('You chose not to open this large file.');
			} else if (outcome.kind === 'full') {
				void handoff?.abandon(
					`Pandia already has ${MAX_TABS} tabs open. Close one, then run the command again.`,
				);
			}
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
		void workspace.restore(drainPendingFiles());
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	$effect(() => {
		let unlisten: UnlistenFn | null = null;
		let cancelled = false;
		listen<string>('menu-event', (e) => {
			const id = e.payload;
			if (id.startsWith('recent::')) {
				const path = id.slice('recent::'.length);
				void workspace.open({ kind: 'file', path });
			} else {
				commandRegistry.run(id);
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

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return; // a focused editor/input already handled it
		const id = matchShortcut(e);
		if (!id) return;
		e.preventDefault();
		commandRegistry.run(id);
	}

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

<svelte:window onkeydown={onWindowKeydown} />

<div class="shell">
	<header
		class="shell-top"
		role="toolbar"
		aria-label="Window top bar"
		tabindex="-1"
		onpointerdown={onTopBarPointerDown}
	>
		<TabBar
			tabs={workspace.tabList}
			activeTabId={workspace.activeId}
			tabStatuses={workspace.statuses}
			capWarning={workspace.capWarning}
			maxTabs={MAX_TABS}
			hasActiveDoc={!!workspace.activeContext}
			{comparePickerOpen}
			bind:compareBtnEl
			onActivate={workspace.activate}
			onClose={(id) => void workspace.close(id)}
			onNew={workspace.create}
			onReorder={workspace.reorder}
			onToggleCompare={toggleComparePicker}
			onExport={() => commandRegistry.get('doc.export')?.run()}
		/>
	</header>

	<div class="shell-body">
		{#snippet sidebarPanel()}
			<Sidebar
				activeTabId={workspace.activeId}
				activeContext={workspace.activeContext}
				onNavigate={requestNavigate}
				onHistoryStep={requestHistoryStep}
			/>
		{/snippet}

		{#if sidebarPrefs.loaded && !sidebarPrefs.collapsed && sidebarPrefs.side === 'left'}
			{@render sidebarPanel()}
		{/if}

		<main class="shell-main">
			{#each workspace.tabs as tab (tab.id)}
				<div class="pane-host" class:active={tab.id === workspace.activeId}>
					<DocPane
						tabId={tab.id}
						slot={workspace.slot(tab.id)}
						isActive={tab.id === workspace.activeId}
						pendingOpen={workspace.pendingOpens[tab.id] ?? null}
						onOpened={() => workspace.clearPendingOpen(tab.id)}
						onOpenInNewTab={(source, opts) => void workspace.open(source, opts)}
						{confirmCommentLoss}
						{confirmSchemaFetch}
						{paneBus}
					/>
				</div>
			{/each}
		</main>

		{#if sidebarPrefs.loaded && !sidebarPrefs.collapsed && sidebarPrefs.side === 'right'}
			{@render sidebarPanel()}
		{/if}
	</div>

	<footer class="shell-status">
		<StatusBar
			status={workspace.activeStatus}
			onPaletteOpen={openPalette}
			onFeedback={() => (feedbackOpen = true)}
			onWhatsNew={() => (whatsNewOpen = true)}
		/>
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
			onLater={() => (recovery = [])}
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
			candidates={workspace.compareCandidates}
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

{#if whatsNewOpen}
	<WhatsNewDialog onClose={() => (whatsNewOpen = false)} />
{/if}

{#if updateCheck.dialogOpen && updateCheck.update}
	<UpdateDialog update={updateCheck.update} />
{/if}

{#if feedbackOpen}
	<FeedbackDialog onShare={shareFeedback} onClose={() => (feedbackOpen = false)} />
{/if}

{#if settingsTab}
	<div class="settings-overlay">
		<SettingsView
			active={settingsTab}
			onSelectTab={(t) => (settingsTab = t)}
			onClose={() => (settingsTab = null)}
		/>
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
		padding: var(--space-sm) var(--space-md);
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
