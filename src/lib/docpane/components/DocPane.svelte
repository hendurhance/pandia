<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { docColumnSchema } from '$lib/ipc/doc';
	import type {
		ColumnSchema,
		DocHandle,
		NodeKind,
		OpenSource,
		Path,
		TypegenLang,
	} from '$lib/ipc/types';
	import type { MenuAction } from '$lib/views/tree/logic/model';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';
	import Breadcrumb from '$lib/views/tree/components/Breadcrumb.svelte';
	import CodeView, { type CodeViewApi } from '$lib/views/code/CodeView.svelte';
	import GridView from '$lib/views/grid/components/GridView.svelte';
	import GridEmpty from '$lib/views/grid/components/GridEmpty.svelte';
	import GraphView, { type GraphViewApi } from '$lib/views/graph/components/GraphView.svelte';
	import CompareView from '$lib/views/compare/components/CompareView.svelte';
	import type { CompareTarget } from '$lib/views/compare/logic/compare-target';
	import { CompareController } from '$lib/views/compare/state/compare.svelte';
	import RowMenu from '$lib/views/tree/components/RowMenu.svelte';
	import FindBar from '$lib/find/components/FindBar.svelte';
	import ExportDialog from '$lib/docpane/components/ExportDialog.svelte';
	import PromptDialog from '$lib/ui/PromptDialog.svelte';
	import { pathToString, basename, stem } from '$lib/util/path';
	import { computeInvalidMarks } from '../logic/invalid-marks';
	import { kindAtSelection, validityFromView } from '../logic/status-derivation';
	import { expandAllDisabled as canExpandAllDisabled, expandAllTitle as makeExpandAllTitle } from '../logic/expand-limits';
	import { expandAll, collapseAll } from '../logic/bulk-tree-ops';
	import { createAutoSaver } from '../logic/auto-save';
	import Icon from '$lib/ui/Icon.svelte';
	import { Check, X } from '@lucide/svelte';
	import { fmtBytes } from '$lib/util/format';
	import { FindController } from '$lib/find/state/find.svelte';
	import { PromptController } from '$lib/ui/prompt.svelte';
	import { createDocPaneCommands } from '../logic/doc-pane-commands';
	import { makeNonceGate } from '../logic/nonce-gate';
	import { createBackupFlusher, BACKUP_IDLE_MS } from '../logic/backup-flush';
	import { createNodeActions, type CutMark } from '$lib/views/tree/logic/node-actions';
	import { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
	import { DocEditController } from '../state/doc-edit.svelte';
	import { DocSessionController } from '../state/doc-session.svelte';
	import { DocNavController } from '../state/doc-nav.svelte';
	import { createDocMenuActions } from '../logic/doc-menu-actions';
	import { handleDocMenuEvent } from '../logic/doc-menu-events';
	import type { DocPaneActions } from '../logic/doc-actions';
	import { schemaStore } from '$lib/panels/state/schema-store.svelte';
	import { commandRegistry } from '$lib/palette/state/command-store.svelte';
	import type { DocStatus } from '$lib/shell/logic/status';
	import EmptyState from '$lib/shell/components/EmptyState.svelte';
	import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
	import { typegenPrefs } from '$lib/panels/state/typegen-prefs.svelte';
	import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';

	type ViewMode = 'tree' | 'code' | 'grid' | 'graph' | 'compare';

	interface Props {
		tabId: string;
		isActive: boolean;
		onLabelChange: (label: string) => void;
		onStatusChange: (status: DocStatus | null) => void;
		pendingOpen?: OpenSource | null;
		onOpened?: () => void;
		
		onOpenInNewTab?: (source: OpenSource, opts?: { focus?: boolean }) => void;
		
		onContextChange?: (
			ctx: {
				handle: DocHandle;
				version: number;
				sourceName: string | null;
				fileBacked: boolean;
				save: (opts?: { silent?: boolean }) => Promise<boolean>;
			} | null,
		) => void;
		navRequest?: { path: Path; nonce: number; tabId: string } | null;
		
		historyRequest?: { delta: number; nonce: number; tabId: string } | null;
		compareRequest?: { target: CompareTarget; nonce: number; tabId: string } | null;
		isHandleAlive?: (h: DocHandle) => boolean;
		
		confirmLargeFile?: (path: string) => Promise<boolean>;
	}

	let {
		tabId,
		isActive,
		onLabelChange,
		onStatusChange,
		pendingOpen = null,
		onOpened = () => {},
		onOpenInNewTab = () => {},
		onContextChange = () => {},
		navRequest = null,
		historyRequest = null,
		compareRequest = null,
		isHandleAlive = () => true,
		confirmLargeFile,
	}: Props = $props();

	function tabLabelFor(name: string | null): string {
		if (!name) return 'untitled';
		const base = basename(name);
		return base.length > 24 ? base.slice(0, 23) + '…' : base;
	}

	let busy = $state(false);
	let error: string | null = $state(null);
	let viewMode: ViewMode = $state('tree');

	let codeApi: CodeViewApi | null = $state(null);
	let codeDirty = $state(false);
	let codeValid = $state<{ valid: boolean; message: string | null } | null>(null);

	$effect(() => {
		if (viewMode !== 'code') {
			codeDirty = false;
			codeValid = null;
		}
	});

	async function switchView(mode: ViewMode) {
		if (viewMode === 'code' && mode !== 'code' && codeDirty && codeApi) {
			if (!(await codeApi.flush())) return;
		}
		viewMode = mode;
	}

	let menuState: { x: number; y: number; rowIndex: number } | null = $state(null);

	const prompt = new PromptController();

	const tree: TreeRowsController = new TreeRowsController({
		handle: () => session.handle,
		summary: () => session.summary,
		setError: (e) => {
			error = e;
		},
	});

	const edit: DocEditController = new DocEditController({
		rows: () => tree.rows,
		handle: () => session.handle,
		apply: (op) => session.applyOp(op),
		setError: (e) => {
			error = e;
		},
	});

	let graphApi = $state<GraphViewApi | null>(null);

	const find: FindController = new FindController({
		handle: () => session.handle,
		canOpen: () => !!session.summary,
		isCodeView: () => viewMode === 'code',
		isGraphView: () => viewMode === 'graph',
		switchToTree: () => {
			if (viewMode !== 'tree') viewMode = 'tree';
		},
		codeApi: () => codeApi,
		openGraphSearch: () => graphApi?.openSearch(),
		navigateToHit: (path) => nav.navigateTo(path),
		afterReplace: async (affectedPaths) => {
			await session.refreshSummary();
			await tree.refetchAfterOp(affectedPaths);
		},
	});

	$effect(() => {
		void viewMode;
		void codeApi;
		untrack(() => find.syncActiveView());
	});

	function showTypegen(lang: TypegenLang) {
		typegenPrefs.setLang(lang);
		sidebarPrefs.setActiveTab('types');
	}

	let gridSchema: ColumnSchema | null = $state(null);
	let gridLoadingFor: number | null = $state(null);
	let gridSelected: { path: Path; kind: NodeKind | null } | null = $state(null);

	const compare: CompareController = new CompareController({
		mainHandle: () => session.handle,
		isHandleAlive: (h) => isHandleAlive(h),
		setViewMode: (mode) => {
			viewMode = mode;
		},
		setBusy: (b) => {
			busy = b;
		},
		setError: (e) => {
			error = e;
		},
	});

	const session: DocSessionController = new DocSessionController({
		tree,
		find,
		compare,
		setBusy: (b) => {
			busy = b;
		},
		setError: (e) => {
			error = e;
		},
		getError: () => error,
		setSelectedPath: (p) => nav.select(p),
		clearViewState: () => {
			gridSchema = null;
			gridLoadingFor = null;
		},
		flushPendingEdits: async () => {
			if (viewMode === 'code' && codeDirty && codeApi) return codeApi.flush();
			return true;
		},
		flash,
		cancelBackupTimer: () => {
			if (backupTimer) clearTimeout(backupTimer);
		},
		confirmLargeFile: (p: string) =>
			confirmLargeFile ? confirmLargeFile(p) : Promise.resolve(true),
	});

	const nav: DocNavController = new DocNavController({
		tree,
		handle: () => session.handle,
		prompt,
		switchToTree: () => {
			if (viewMode !== 'tree') viewMode = 'tree';
		},
		setError: (e) => {
			error = e;
		},
	});

	onDestroy(() => {
		session.dispose();
	});

	const compareGate = makeNonceGate();
	const navGate = makeNonceGate();
	const historyGate = makeNonceGate();

	$effect(() => {
		if (!session.handle) return;
		if (compareGate(compareRequest, tabId, isActive)) {
			void compare.start(compareRequest!.target);
		}
	});
	$effect(() => {
		if (!session.handle) return;
		if (navGate(navRequest, tabId, isActive)) {
			void nav.navigateTo(navRequest!.path);
		}
	});
	$effect(() => {
		if (!session.handle) return;
		if (historyGate(historyRequest, tabId, isActive)) {
			void session.runHistory(historyRequest!.delta);
		}
	});

	let saveFlash: string | null = $state(null);

	function flash(msg: string) {
		saveFlash = msg;
		setTimeout(() => (saveFlash = null), 1500);
	}

	let exportOpen = $state(false);

	const isDirty = $derived((session.summary?.dirty ?? false) || codeDirty);

	const backup = createBackupFlusher({
		handle: () => session.handle,
		sourceName: () => session.sourceName,
		isDirty: () => isDirty,
		codeDirty: () => codeDirty,
		flushCodeBuffer: () => codeApi?.flush() ?? Promise.resolve(true),
	});

	let backupTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const h = session.handle;
		const v = session.summary?.version ?? 0;
		void v;
		void codeDirty;
		if (!h || !isDirty) return;
		if (backupTimer) clearTimeout(backupTimer);
		backupTimer = setTimeout(() => void backup.flush(), BACKUP_IDLE_MS);
		return () => {
			if (backupTimer) clearTimeout(backupTimer);
		};
	});

	let prevActive = false;
	$effect(() => {
		const nowActive = isActive;
		if (prevActive && !nowActive && isDirty) void backup.flush();
		prevActive = nowActive;
	});

	$effect(() => {
		function onBlur() {
			if (isDirty) void backup.flush();
		}
		window.addEventListener('blur', onBlur);
		return () => window.removeEventListener('blur', onBlur);
	});

	const autoSaver = createAutoSaver({
		isDirty: () => isDirty,
		isFileBacked: () => session.summary?.fileBacked ?? false,
		autoSaveOnIdle: () => behaviorPrefs.autoSaveOnIdle,
		autoSaveIdleMs: () => behaviorPrefs.autoSaveIdleMs,
		save: (opts) => session.save(opts),
	});
	$effect(() => {
		void session.summary?.version;
		void codeDirty;
		void isDirty;
		void behaviorPrefs.autoSaveOnIdle;
		void behaviorPrefs.autoSaveIdleMs;
		return autoSaver.schedule();
	});

	$effect(() => {
		if (nav.selectedPath !== null && nav.selectedIndex === -1) {
			nav.select(null);
		}
	});

	const invalidMarks = $derived(
		computeInvalidMarks({
			result: schemaStore.get(tabId).result,
			validatedVersion: schemaStore.get(tabId).validatedVersion,
			liveVersion: session.summary?.version ?? null,
			rows: tree.rows,
		}),
	);

	let cutMark = $state<CutMark | null>(null);

	const nodeActions = createNodeActions({
		handle: () => session.handle,
		rows: () => tree.rows,
		selectedIndex: () => nav.selectedIndex,
		setSelectedPath: nav.select,
		siblingCount: tree.siblingCount,
		prompt,
		apply: (op) => session.applyOp(op),
		setError: (e) => {
			error = e;
		},
		flash,
		onOpenInNewTab: (source) => onOpenInNewTab(source),
		getCutMark: () => cutMark,
		setCutMark: (m) => {
			cutMark = m;
		},
	});

	const menuAction = createDocMenuActions({
		edit,
		nodeActions,
		apply: (op) => session.applyOp(op),
	});

	const actions: DocPaneActions = {
		hasDoc: () => !!session.summary,
		isCodeView: () => viewMode === 'code',
		expandAllDisabled: () => expandAllDisabled,
		inCompare: () => compare.active,
		find,
		selectedContentRow: nodeActions.selectedContentRow,
		moveBounds: nodeActions.moveBounds,
		doSave: session.save,
		doSaveAs: session.saveAs,
		openExport: () => {
			if (session.summary) exportOpen = true;
		},
		switchView,
		undo: () => {
			if (viewMode === 'code' && codeApi) codeApi.undo();
			else if (edit.active) edit.cancel();
			else void session.undo();
		},
		redo: () => {
			if (viewMode === 'code' && codeApi) codeApi.redo();
			else void session.redo();
		},
		close: session.reset,
		goToPath: nav.goToPath,
		onExpandAll,
		onCollapseAll,
		menuMove: nodeActions.move,
		menuSortKeys: nodeActions.sortKeys,
		menuCopy: nodeActions.copy,
		menuCopyPath: nodeActions.copyPath,
		menuCut: nodeActions.cut,
		menuPaste: nodeActions.paste,
		menuExtract: nodeActions.extract,
		showTypegen,
		onPickCompareFile: compare.pickFile,
		exitCompare: compare.exit,
	};

	$effect(() => {
		let unlisten: UnlistenFn | null = null;
		let cancelled = false;
		listen<string>('menu-event', (e) => {
			if (isActive) handleDocMenuEvent(e.payload, actions);
		}).then((fn) => {
			if (cancelled) fn();
			else unlisten = fn;
		});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	$effect(() => {
		onLabelChange(tabLabelFor(session.sourceName));
	});

	$effect(() => {
		if (session.handle && session.summary) {
			onContextChange({
				handle: session.handle,
				version: session.summary.version,
				sourceName: session.sourceName,
				fileBacked: session.summary.fileBacked,
				save: (opts) => session.save(opts),
			});
		} else {
			onContextChange(null);
		}
	});

	const status = $derived.by<DocStatus | null>(() => {
		const s = session.summary;
		if (s === null) return null;
		const inGrid = viewMode === 'grid';
		const activePath =
			viewMode === 'tree' ? nav.selectedPath : inGrid ? (gridSelected?.path ?? null) : null;
		return {
			pathDisplay: activePath !== null ? pathToString(activePath) : null,
			kindDisplay: inGrid
				? (gridSelected?.kind ?? null)
				: kindAtSelection(tree.rows, tree.contentRowIdx, activePath, s.rootKind),
			sizeDisplay: fmtBytes(s.sourceSize),
			lazy: s.lazy,
			validity: validityFromView({
				viewMode,
				codeValid,
				schemaResult: schemaStore.get(tabId).result,
			}),
			editing: edit.active,
			dirty: isDirty,
		};
	});

	$effect(() => {
		onStatusChange(status);
	});

	$effect(() => {
		if (!isActive) return;
		const cmds = createDocPaneCommands(actions);
		const dispose = cmds.map((c) => commandRegistry.register(c));
		return () => {
			for (const d of dispose) d();
		};
	});

	const expandAllDisabled = $derived(
		canExpandAllDisabled({ summary: session.summary, busy }),
	);
	const expandAllTitle = $derived(makeExpandAllTitle({ summary: session.summary, busy }));

	$effect(() => {
		if (!session.handle || !session.summary) return;
		const v = session.summary.version;
		if (gridLoadingFor === v) return;
		const rootIsNonEmptyArray =
			session.summary.rootKind === 'array' && (session.summary.rootChildCount ?? 0) > 0;
		if (!rootIsNonEmptyArray && viewMode !== 'grid') return;
		gridLoadingFor = v;
		const h = session.handle;
		void docColumnSchema(h, [])
			.then((s) => {
				if (session.handle === h && session.summary?.version === v) gridSchema = s;
			})
			.catch((e) => {
				if (session.handle === h) error = String(e);
			});
	});

	$effect(() => {
		const p = pendingOpen;
		if (!p) return;
		void (async () => {
			await session.loadFromSource(p);
			onOpened();
		})();
	});

	function onRowMenu(rowIndex: number, x: number, y: number) {
		const row = tree.rows[rowIndex];
		if (row?.variant !== 'content') return;
		menuState = { x, y, rowIndex };
	}

	const menuMoveBounds = $derived.by(() => {
		const r = menuState ? tree.rows[menuState.rowIndex] : null;
		if (r?.variant !== 'content') return { up: false, down: false };
		return nodeActions.moveBounds(r);
	});

	const menuRow = $derived.by(() => {
		if (!menuState) return null;
		return tree.rows[menuState.rowIndex] ?? null;
	});

	function onMenuClose() {
		menuState = null;
	}

	async function onMenuAction(action: MenuAction) {
		const row = menuState ? tree.rows[menuState.rowIndex] : null;
		if (row?.variant !== 'content') return;
		await menuAction(action, menuState!.rowIndex, row);
	}

	async function onExpandAll() {
		if (expandAllDisabled) return;
		await expandAll({ tree, setBusy: (b) => (busy = b) });
	}

	async function onCollapseAll() {
		await collapseAll({ tree, summary: session.summary, selectPath: nav.select });
	}
</script>

<section class="page">
	{#if session.summary}
		<div class="canvas-head">
			<div class="view-modes">
				<button
					class="vm"
					class:active={viewMode === 'tree'}
					onclick={() => void switchView('tree')}
					title="tree view (⌘1)">Tree</button
				>
				<button
					class="vm"
					class:active={viewMode === 'code'}
					onclick={() => void switchView('code')}
					title="code view (⌘2)">Code</button
				>
				<button
					class="vm"
					class:active={viewMode === 'grid'}
					class:available={gridSchema?.gridSuitable && viewMode !== 'grid'}
					onclick={() => void switchView('grid')}
					title={gridSchema?.gridSuitable
						? 'grid view (⌘3) · this document looks like a grid'
						: 'grid view (⌘3)'}
					>Grid{#if gridSchema?.gridSuitable && viewMode !== 'grid'}<span
							class="vm-dot"
							aria-hidden="true"
						></span>{/if}</button
				>
				<button
					class="vm"
					class:active={viewMode === 'graph'}
					onclick={() => void switchView('graph')}
					title="graph view (⌘4)">Graph</button
				>
				{#if viewMode === 'compare'}
					<button class="vm active" onclick={compare.exit} title="exit compare">Compare</button>
				{/if}
			</div>
			<span class="canvas-spacer"></span>
		</div>
	{/if}

	{#if error}
		<div class="banner banner-err">
			<span class="err-text">{error}</span>
			<button class="err-dismiss" onclick={() => (error = null)} aria-label="dismiss error"
				><Icon icon={X} size="sm" /></button
			>
		</div>
	{/if}

	{#if saveFlash && !error}
		<div class="banner banner-saved"><Icon icon={Check} size="sm" /> {saveFlash}</div>
	{/if}

	{#if session.repairInfo && !error}
		<div class="banner banner-info">
			<span class="info-head"
				>repaired
				{#if session.repairInfo.wasUnescaped}
					· unescaped{/if}
				{#if session.repairInfo.cleanedUp}
					· cleaned{/if}
			</span>
			{#if session.repairInfo.warnings.length > 0}
				<span class="info-list">
					{#each session.repairInfo.warnings as w, i (i)}
						<span class="info-item">{w}</span>
					{/each}
					{#if session.repairInfo.more > 0}
						<span class="info-more">+{session.repairInfo.more} more</span>
					{/if}
				</span>
			{/if}
			<button class="info-dismiss" onclick={() => (session.repairInfo = null)} aria-label="dismiss"
				><Icon icon={X} size="sm" /></button
			>
		</div>
	{/if}

	{#if !session.summary}
		<EmptyState {busy} onOpenSource={session.loadFromSource} />
	{:else if viewMode === 'tree'}
		<Breadcrumb
			path={nav.selectedPath}
			onSegment={nav.onSegment}
			{onExpandAll}
			{onCollapseAll}
			{expandAllDisabled}
			{expandAllTitle}
			onSearch={find.openFind}
			editing={edit.active}
		/>
		<div class="tree-pane">
			<TreeView
				rows={tree.rows}
				selectedIndex={nav.selectedIndex}
				onToggle={tree.toggleAt}
				onSelect={nav.selectRow}
				onVisibleRange={tree.onVisibleRange}
				onMaterializeGap={tree.materializeGap}
				onReorder={(dragged, gap) => void nodeActions.reorderTo(dragged, gap)}
				{onRowMenu}
				scrollRequest={nav.scrollRequest}
				editing={edit.state}
				onEditInput={edit.input}
				onEditCommit={edit.commit}
				onEditCancel={edit.cancel}
				{invalidMarks}
				cutPath={cutMark?.path ?? null}
			/>
			<FindBar
				open={find.open}
				query={find.query}
				counter={find.counter}
				navDisabled={find.navDisabled}
				isError={find.error != null}
				busy={find.busy}
				onQueryChange={find.onQueryChange}
				onPrev={find.prev}
				onNext={find.next}
				onClose={find.close}
				onCancel={find.cancel}
				replaceValue={find.replaceValue}
				onReplaceChange={(v) => (find.replaceValue = v)}
				onReplaceAll={find.replaceAll}
				replaceStatus={find.replaceStatus}
			/>
		</div>
	{:else if viewMode === 'compare' && session.handle && compare.handle && session.summary && compare.summary}
		<CompareView
			leftHandle={session.handle}
			rightHandle={compare.handle}
			leftSourceSize={session.summary.sourceSize}
			rightSourceSize={compare.summary.sourceSize}
			leftName={session.sourceName ?? 'left'}
			rightName={compare.sourceName ?? 'right'}
			staleSource={compare.staleSource}
			onExit={() => void compare.exit()}
		/>
	{:else if viewMode === 'code'}
		<div class="code-pane">
			<CodeView
				handle={session.handle}
				sourceSize={session.summary.sourceSize}
				editable
				onCommit={async (text) => (await session.commitText(text)) !== null}
				onDirtyChange={(d) => (codeDirty = d)}
				onReady={(a) => (codeApi = a)}
				onParseState={(st) => (codeValid = st)}
			/>
			<FindBar
				open={find.open}
				query={find.query}
				counter={find.counter}
				navDisabled={find.navDisabled}
				isError={find.error != null}
				onQueryChange={find.onQueryChange}
				onPrev={find.prev}
				onNext={find.next}
				onClose={find.close}
				replaceValue={find.replaceValue}
				onReplaceChange={(v) => (find.replaceValue = v)}
				onReplaceAll={find.replaceAll}
				replaceStatus={find.replaceStatus}
			/>
		</div>
	{:else if viewMode === 'graph' && session.handle}
		<GraphView
			handle={session.handle}
			rootKind={session.summary.rootKind}
			rootChildCount={session.summary.rootChildCount}
			sourcePath={session.summary.sourcePath}
			onPickPath={nav.onGraphPick}
			onReady={(a) => (graphApi = a)}
		/>
	{:else if gridSchema && session.handle}
		{#if gridSchema.gridSuitable}
			<GridView
				handle={session.handle}
				path={[]}
				schema={gridSchema}
				onOpenInTree={(p) => void nav.navigateTo(p)}
				onCellSelect={(c) => (gridSelected = c)}
				docKey={session.summary?.sourcePath ?? null}
				onExtract={(values) => {
					const name = stem(session.sourceName ?? 'rows').slice(0, 24);
					onOpenInNewTab({
						kind: 'text',
						text: JSON.stringify(values, null, 2),
						name: `${name} ◂ ${values.length} rows.json`,
					});
				}}
			/>
		{:else}
			<GridEmpty schema={gridSchema} rootKind={session.summary.rootKind} />
		{/if}
	{:else}
		<div class="empty-state">
			<div class="empty-state-inner"><div class="dim text-sm">Loading grid…</div></div>
		</div>
	{/if}
</section>

{#if menuState && menuRow?.variant === 'content'}
	<RowMenu
		x={menuState.x}
		y={menuState.y}
		row={menuRow}
		canMoveUp={menuMoveBounds.up}
		canMoveDown={menuMoveBounds.down}
		onAction={onMenuAction}
		onClose={onMenuClose}
	/>
{/if}

{#if prompt.state}
	<PromptDialog
		message={prompt.state.message}
		defaultValue={prompt.state.defaultValue}
		onCommit={prompt.commit}
		onCancel={prompt.cancel}
	/>
{/if}

{#if exportOpen && session.handle && session.summary}
	<ExportDialog
		handle={session.handle}
		sourceName={session.sourceName}
		onClose={() => (exportOpen = false)}
	/>
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.canvas-head {
		display: flex;
		align-items: stretch;
		height: 32px;
		border-bottom: var(--rule-width) solid var(--rule);
		flex-shrink: 0;
	}
	.view-modes {
		display: flex;
		align-items: stretch;
		border-right: var(--rule-width) solid var(--rule);
		flex-shrink: 0;
	}
	.vm {
		display: inline-flex;
		align-items: center;
		padding: 0 14px;
		font-size: var(--font-size-xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-faint);
		background: transparent;
		border: none;
		border-right: var(--rule-width) solid var(--rule);
		cursor: pointer;
		position: relative;
		white-space: nowrap;
	}
	.vm:hover {
		color: var(--text-dim);
	}
	.vm.active {
		color: var(--text);
		background: var(--bg-elev);
	}
	.vm.active::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		background: var(--accent);
	}
	.vm-dot {
		display: inline-block;
		width: 5px;
		height: 5px;
		background: var(--accent);
		margin-left: 8px;
	}
	.canvas-spacer {
		flex: 1;
	}

	.dim:hover {
		color: var(--accent);
	}

	.err-text {
		flex: 1;
		min-width: 0;
	}
	.err-dismiss {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--accent);
		font-size: 14px;
		line-height: 1;
		padding: 0 0.3rem;
		cursor: pointer;
	}
	.err-dismiss:hover {
		color: var(--text);
	}

	.info-head {
		color: var(--accent-2);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		flex-shrink: 0;
	}
	.info-list {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		min-width: 0;
	}
	.info-item {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.info-item::after {
		content: '·';
		margin-left: 0.4rem;
		color: var(--text-faint);
	}
	.info-item:last-child::after {
		content: '';
	}
	.info-more {
		color: var(--text-faint);
	}
	.info-dismiss {
		margin-left: auto;
		flex-shrink: 0;
		background: transparent;
		border: none;
		padding: 0 0.5rem;
		color: var(--text-faint);
		font-size: 14px;
		cursor: pointer;
	}
	.info-dismiss:hover {
		color: var(--accent);
	}

	
	.tree-pane {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.code-pane {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
