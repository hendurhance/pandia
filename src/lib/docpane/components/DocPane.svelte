<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ipc } from '$lib/ipc/client';
	import { decodeLossless } from '$lib/ipc/wire';
	import { describeError } from '$lib/ipc/error-copy';
	import type { ColumnSchema, NodeKind, OpenSource, Path, TypegenLang } from '$lib/ipc/bindings';
	import { rootRow, type MenuAction } from '$lib/views/tree/logic/model';
	import { chipText } from '$lib/views/tree/logic/row-format';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';
	import Breadcrumb from '$lib/views/tree/components/Breadcrumb.svelte';
	import CodeView, { type CodeViewApi } from '$lib/views/code/CodeView.svelte';
	import GridView from '$lib/views/grid/components/GridView.svelte';
	import GridEmpty from '$lib/views/grid/components/GridEmpty.svelte';
	import GraphView, { type GraphViewApi } from '$lib/views/graph/components/GraphView.svelte';
	import CompareView from '$lib/views/compare/components/CompareView.svelte';
	import type { PaneCommandBus } from '$lib/shell/state/pane-bus';
	import RowMenu from '$lib/views/tree/components/RowMenu.svelte';
	import FindBar from '$lib/find/components/FindBar.svelte';
	import ExportDialog from '$lib/docpane/components/ExportDialog.svelte';
	import PromptDialog from '$lib/ui/PromptDialog.svelte';
	import { pathToString, basename, stem, truncatePathMiddle } from '$lib/util/path';
	import { computeInvalidMarks } from '../logic/invalid-marks';
	import { kindAtSelection, validityFromView } from '../logic/status-derivation';
	import {
		expandAllDisabled as canExpandAllDisabled,
		expandAllTitle as makeExpandAllTitle,
	} from '../logic/expand-limits';
	import { expandAll, collapseAll } from '../logic/bulk-tree-ops';
	import Icon from '$lib/ui/Icon.svelte';
	import { Check, X } from '@lucide/svelte';
	import { fmtBytes } from '$lib/util/format';
	import { shortcutLabel } from '$lib/shell/logic/shortcuts';
	import { createDocPaneCommands } from '../logic/doc-pane-commands';
	import { DocumentSession } from '../state/document-session.svelte';
	import type { DocPaneActions } from '../logic/doc-actions';
	import { lastResult, schemaSessions } from '$lib/panels/state/schema-store.svelte';
	import { autoloadSchema } from '$lib/panels/state/schema-autoload';
	import type { DocContext, TabSlot } from '$lib/shell/state/workspace.svelte';
	import { commandRegistry } from '$lib/palette/state/command-store.svelte';
	import type { DocStatus } from '$lib/shell/logic/status';
	import EmptyState from '$lib/shell/components/EmptyState.svelte';
	import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
	import { typegenPrefs } from '$lib/panels/state/typegen-prefs.svelte';

	interface Props {
		tabId: string;
		slot: TabSlot;
		isActive: boolean;
		pendingOpen?: OpenSource | null;
		onOpened?: () => void;

		onOpenInNewTab?: (source: OpenSource, opts?: { focus?: boolean }) => void;

		paneBus?: PaneCommandBus | null;

		confirmCommentLoss?: (name: string) => Promise<'save' | 'saveAs' | 'cancel'>;

		confirmSchemaFetch?: (host: string) => Promise<boolean>;
	}

	let {
		tabId,
		slot,
		isActive,
		pendingOpen = null,
		onOpened = () => {},
		onOpenInNewTab = () => {},
		paneBus = null,
		confirmCommentLoss,
		confirmSchemaFetch = () => Promise.resolve(false),
	}: Props = $props();

	function tabLabelFor(name: string | null): string {
		if (!name) return 'untitled';
		return truncatePathMiddle(basename(name), 24);
	}

	let dismissedNoteFor = $state<string | null>(null);

	let codeApi: CodeViewApi | null = $state(null);
	let codeDirty = $state(false);
	let codeValid = $state<{ valid: boolean; message: string | null } | null>(null);

	$effect(() => {
		if (doc.viewMode !== 'code') {
			codeDirty = false;
			codeValid = null;
		}
	});

	let menuState: { x: number; y: number; rowIndex: number } | null = $state(null);

	let graphApi = $state<GraphViewApi | null>(null);

	$effect(() => {
		void doc.viewMode;
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

	const doc = new DocumentSession({
		isActive: () => isActive,
		onOpenInNewTab: (source) => onOpenInNewTab(source),
		isHandleAlive: (h) => slot.isHandleAlive(h),
		confirmCommentLoss: (n) =>
			confirmCommentLoss ? confirmCommentLoss(n) : Promise.resolve('save' as const),
		code: { api: () => codeApi, dirty: () => codeDirty },
		graphApi: () => graphApi,
		clearViewState: () => {
			gridSchema = null;
			gridLoadingFor = null;
		},
	});
	const { session, tree, edit, find, compare, nav, nodeActions, menuAction, prompt } = doc;

	const recoveryNoteDismissed = $derived(
		session.handle != null && dismissedNoteFor === String(session.handle),
	);

	onDestroy(() => {
		doc.dispose();
	});

	$effect(() => {
		if (!paneBus) return;
		return paneBus.subscribe(tabId, (cmd) => {
			if (!session.handle) return;
			if (cmd.kind === 'navigate') void nav.navigateTo(cmd.path);
			else if (cmd.kind === 'history') void session.runHistory(cmd.delta);
			else void compare.start(cmd.target);
		});
	});

	let exportOpen = $state(false);

	$effect(() => {
		void tree.rows;
		const path = nav.selectedPath;
		if (path !== null && !session.refreshing && tree.contentRowIdx(path) === -1) {
			nav.select(null);
		}
	});

	const schema = $derived(schemaSessions.for(tabId));

	$effect(() => {
		const handle = session.handle;
		const version = session.summary?.version;
		if (handle && version !== undefined) schema.documentChanged(handle, version);
	});

	const invalidMarks = $derived(
		computeInvalidMarks({
			result: lastResult(schema.verdict),
			stale: schema.verdict.kind === 'checking' || schema.verdict.kind === 'stale',
			rows: tree.rows,
		}),
	);

	const actions: DocPaneActions = {
		hasDoc: () => !!session.summary,
		isCodeView: () => doc.viewMode === 'code',
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
		switchView: doc.switchView,
		undo: () => {
			if (doc.viewMode === 'code' && codeApi) codeApi.undo();
			else if (edit.active) edit.cancel();
			else void session.undo();
		},
		redo: () => {
			if (doc.viewMode === 'code' && codeApi) codeApi.redo();
			else void session.redo();
		},
		close: async () => {
			if (await slot.resolveUnsaved()) await session.reset();
		},
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

	const contextHandle = $derived(session.handle);
	const contextVersion = $derived(session.summary?.version ?? null);
	const contextFileBacked = $derived(session.summary?.fileBacked ?? false);
	const context = $derived.by<DocContext | null>(() =>
		contextHandle && contextVersion !== null
			? {
					handle: contextHandle,
					version: contextVersion,
					sourceName: session.sourceName,
					fileBacked: contextFileBacked,
					save: (opts) => session.save(opts),
				}
			: null,
	);

	const status = $derived.by<DocStatus | null>(() => {
		const s = session.summary;
		if (s === null) return null;
		const inGrid = doc.viewMode === 'grid';
		const activePath =
			doc.viewMode === 'tree' ? nav.selectedPath : inGrid ? (gridSelected?.path ?? null) : null;
		return {
			pathDisplay: activePath !== null ? pathToString(activePath) : null,
			kindDisplay: inGrid
				? (gridSelected?.kind ?? null)
				: kindAtSelection(tree.rows, tree.contentRowIdx, activePath, s.rootKind),
			sizeDisplay: fmtBytes(s.sourceSize),
			rootCountDisplay: chipText(rootRow(s.rootKind, s.rootChildCount)),
			lazy: s.lazy,
			validity: validityFromView({
				viewMode: doc.viewMode,
				codeValid,
				schemaResult: lastResult(schema.verdict),
			}),
			editing: edit.active,
			dirty: doc.isDirty,
		};
	});

	$effect(() =>
		slot.register({
			get label() {
				return tabLabelFor(session.sourceName);
			},
			get sourceName() {
				return session.sourceName;
			},
			get status() {
				return status;
			},
			get context() {
				return context;
			},
		}),
	);

	$effect(() => {
		if (!isActive) return;
		const cmds = createDocPaneCommands(actions);
		const dispose = cmds.map((c) => commandRegistry.register(c));
		return () => {
			for (const d of dispose) d();
		};
	});

	const expandAllDisabled = $derived(
		canExpandAllDisabled({ summary: session.summary, busy: doc.busy }),
	);
	const expandAllTitle = $derived(makeExpandAllTitle({ summary: session.summary, busy: doc.busy }));

	$effect(() => {
		if (!session.handle || !session.summary) return;
		const v = session.summary.version;
		if (gridLoadingFor === v) return;
		const rootIsNonEmptyArray =
			session.summary.rootKind === 'array' && (session.summary.rootChildCount ?? 0) > 0;
		if (!rootIsNonEmptyArray && doc.viewMode !== 'grid') return;
		gridLoadingFor = v;
		const h = session.handle;
		void ipc
			.docColumnSchema(h, [])
			.then((s) => {
				if (session.handle === h && session.summary?.version === v) gridSchema = s;
			})
			.catch((e) => {
				if (session.handle === h) doc.error = describeError(e);
			});
	});

	$effect(() => {
		session.handoff = slot.handoff;
	});

	$effect(() => {
		const p = pendingOpen;
		if (!p) return;
		void (async () => {
			const opened = await session.loadFromSource(p);
			onOpened();
			const s = session.summary;
			const handoff = slot.handoff;
			const instructions = handoff?.takeInstructions() ?? null;
			if (!opened || !session.handle || !s) {
				handoff?.failed(doc.error ?? "The file didn't open.");
				return;
			}
			handoff?.opened();
			if (instructions?.compareWith) {
				void compare.start({ kind: 'path', path: instructions.compareWith });
			}
			await loadDocSchema(instructions?.schema ?? null);
		})();
	});

	function loadDocSchema(cliSchema: string | null): Promise<void> {
		const s = session.summary;
		if (!session.handle || !s) return Promise.resolve();
		return autoloadSchema(
			{
				tabId,
				handle: session.handle,
				version: s.version,
				path: s.sourcePath,
				rootIsObject: s.rootKind === 'object',
				cliSchema,
			},
			confirmSchemaFetch,
		);
	}

	async function openInPlace(opening: Promise<boolean>): Promise<boolean> {
		const opened = await opening;
		if (opened) void loadDocSchema(null);
		return opened;
	}

	async function readString(path: Path): Promise<string | null> {
		if (!session.handle) return null;
		try {
			const value = decodeLossless(await ipc.docGetValue(session.handle, path));
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	}

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

	async function onRowAction(rowIndex: number, action: MenuAction) {
		const row = tree.rows[rowIndex];
		if (row?.variant !== 'content') return;
		await menuAction(action, rowIndex, row);
	}

	async function onMenuAction(action: MenuAction) {
		if (menuState) await onRowAction(menuState.rowIndex, action);
	}

	const openTree = () => void doc.switchView('tree');

	async function onExpandAll() {
		if (expandAllDisabled) return;
		await expandAll({ tree, setBusy: (b) => (doc.busy = b) });
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
					class:active={doc.viewMode === 'tree'}
					onclick={() => void doc.switchView('tree')}
					title={`tree view (${shortcutLabel('view.tree')})`}>Tree</button
				>
				<button
					class="vm"
					class:active={doc.viewMode === 'code'}
					onclick={() => void doc.switchView('code')}
					title={`code view (${shortcutLabel('view.code')})`}>Code</button
				>
				<button
					class="vm"
					class:active={doc.viewMode === 'grid'}
					class:available={gridSchema?.gridSuitable && doc.viewMode !== 'grid'}
					onclick={() => void doc.switchView('grid')}
					title={gridSchema?.gridSuitable
						? `grid view (${shortcutLabel('view.grid')}) · this document looks like a grid`
						: `grid view (${shortcutLabel('view.grid')})`}
					>Grid{#if gridSchema?.gridSuitable && doc.viewMode !== 'grid'}<span
							class="vm-dot"
							aria-hidden="true"
						></span>{/if}</button
				>
				<button
					class="vm"
					class:active={doc.viewMode === 'graph'}
					onclick={() => void doc.switchView('graph')}
					title={`graph view (${shortcutLabel('view.graph')})`}>Graph</button
				>
				{#if doc.viewMode === 'compare'}
					<button class="vm active" onclick={compare.exit} title="exit compare">Compare</button>
				{/if}
			</div>
			<span class="canvas-spacer"></span>
		</div>
	{/if}

	{#if doc.error && !session.diagnosis}
		<div class="banner banner-err">
			<span class="err-text">{doc.error}</span>
			<button class="err-dismiss" onclick={() => (doc.error = null)} aria-label="dismiss error"
				><Icon icon={X} size="sm" /></button
			>
		</div>
	{/if}

	{#if slot.handoff?.waiting && session.handle}
		<div class="banner banner-info">
			<span class="info-head">a terminal is waiting</span>
			<span class="info-list"
				><span class="info-item"
					>{slot.handoff?.repliesToTerminal
						? `Save (${shortcutLabel('doc.save')}) to send this back, then close the tab. Closing without saving sends nothing.`
						: 'Close this tab when you are done.'}</span
				></span
			>
		</div>
	{/if}

	{#if doc.saveFlash && !doc.error}
		<div class="banner banner-saved"><Icon icon={Check} size="sm" /> {doc.saveFlash}</div>
	{/if}

	{#if session.summary?.recoveryNote && !doc.error && !recoveryNoteDismissed}
		<div class="banner banner-info">
			<span class="info-head">loaded with 1 cleanup</span>
			<span class="info-list"><span class="info-item">{session.summary.recoveryNote}</span></span>
			<button
				class="info-dismiss"
				onclick={() => (dismissedNoteFor = String(session.handle))}
				aria-label="dismiss"><Icon icon={X} size="sm" /></button
			>
		</div>
	{/if}

	{#if session.repairInfo && !doc.error}
		<div class="banner banner-info">
			<span class="info-head">{session.repairInfo.title}</span>
			{#if session.repairInfo.notes.length > 0}
				<span class="info-list">
					{#each session.repairInfo.notes as w, i (i)}
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
		<EmptyState
			busy={doc.busy}
			onOpenSource={(source) => openInPlace(session.loadFromSource(source))}
			onOpenFile={(path) => onOpenInNewTab({ kind: 'file', path })}
			diagnosis={session.diagnosis}
			onFixDiagnosis={(t) => void openInPlace(session.applyDiagnosisFix(t))}
			onDismissDiagnosis={() => (session.diagnosis = null)}
		/>
	{:else if doc.viewMode === 'tree'}
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
				{readString}
				selectedIndex={nav.selectedIndex}
				onToggle={tree.toggleAt}
				onSelect={nav.selectRow}
				onVisibleRange={tree.onVisibleRange}
				onMaterializeGap={tree.materializeGap}
				onReorder={(dragged, gap) => void nodeActions.reorderTo(dragged, gap)}
				{onRowMenu}
				{onRowAction}
				scrollRequest={nav.scrollRequest}
				editing={edit.state}
				onEditInput={edit.input}
				onEditCommit={edit.commit}
				onEditCancel={edit.cancel}
				{invalidMarks}
				cutPath={doc.cutMark?.path ?? null}
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
				replaceOpen={find.replaceOpen}
				onToggleReplace={() => (find.replaceOpen = !find.replaceOpen)}
			/>
		</div>
	{:else if doc.viewMode === 'compare' && session.handle && compare.handle && session.summary && compare.summary}
		<CompareView
			leftHandle={session.handle}
			rightHandle={compare.handle}
			leftSourceSize={session.summary.sourceSize}
			rightSourceSize={compare.summary.sourceSize}
			leftName={session.sourceName ?? 'left'}
			rightName={compare.sourceName ?? 'right'}
			leftVersion={session.summary.version}
			rightVersion={slot.versionOf(compare.handle) ?? compare.summary.version}
			staleSource={compare.staleSource}
			onExit={() => void compare.exit()}
		/>
	{:else if doc.viewMode === 'code'}
		<div class="code-pane">
			<CodeView
				handle={session.handle}
				sourceSize={session.summary.sourceSize}
				editable
				onCommit={async (text) => (await session.commitText(text)) !== null}
				onDirtyChange={(d) => (codeDirty = d)}
				onReady={(a) => (codeApi = a)}
				onParseState={(st) => (codeValid = st)}
				onOpenTree={openTree}
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
				replaceOpen={find.replaceOpen}
				onToggleReplace={() => (find.replaceOpen = !find.replaceOpen)}
			/>
		</div>
	{:else if doc.viewMode === 'graph' && session.handle}
		<GraphView
			handle={session.handle}
			version={session.summary.version}
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
				onError={(e) => (doc.error = e)}
				onExtract={(text, count) => {
					const name = stem(session.sourceName ?? 'rows').slice(0, 24);
					onOpenInNewTab({
						kind: 'text',
						text,
						name: `${name} ◂ ${count} rows.json`,
					});
				}}
			/>
		{:else}
			<GridEmpty schema={gridSchema} rootKind={session.summary.rootKind} onOpenTree={openTree} />
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
		padding: 0 var(--space-lg);
		font-size: var(--font-size-xs);
		letter-spacing: var(--label-tracking);
		text-transform: uppercase;
		color: var(--text-dim);
		background: transparent;
		border: none;
		border-right: var(--rule-width) solid var(--rule);
		cursor: pointer;
		position: relative;
		white-space: nowrap;
	}
	.vm:hover {
		color: var(--text);
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
		margin-left: var(--space-sm);
	}
	.canvas-spacer {
		flex: 1;
	}

	.err-text {
		flex: 1;
		min-width: 0;
	}
	.err-dismiss {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--text-dim);
		font-size: var(--font-size-base);
		line-height: 1;
		padding: 0 var(--space-xs);
		cursor: pointer;
	}
	.err-dismiss:hover {
		color: var(--text);
	}

	.info-head {
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		flex-shrink: 0;
	}
	.info-list {
		display: flex;
		gap: var(--space-xs);
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
		margin-left: var(--space-xs);
		color: var(--text-faint);
	}
	.info-item:last-child::after {
		content: '';
	}
	.info-more {
		color: var(--text-dim);
	}
	.info-dismiss {
		margin-left: auto;
		flex-shrink: 0;
		background: transparent;
		border: none;
		padding: 0 var(--space-sm);
		color: var(--text-dim);
		font-size: var(--font-size-base);
		cursor: pointer;
	}
	.info-dismiss:hover {
		color: var(--text);
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
