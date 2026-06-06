<script lang="ts">
	import type { ColumnSchema, DocHandle, NodeKind, Path } from '$lib/ipc/types';
	import {
		computeColumnLayout,
		columnWindow,
		autoFitWidthPx,
		PX_PER_CH,
	} from '../logic/grid-geometry';
	import { cellClass, cellRender, cellTitle } from '../logic/grid-cell';
	import { contentXFromClient, gapForX } from '../logic/column-reorder-math';
	import { createAutoScroller } from '$lib/ui/auto-scroll';
	import { GridDataController, ROW_HEIGHT } from '../state/grid-data.svelte';
	import { GridFilterController } from '../state/grid-filters.svelte';
	import { GridSelectionController } from '../state/grid-select.svelte';
	import CellInspector from './CellInspector.svelte';
	import ColumnFilterPopover from './ColumnFilterPopover.svelte';
	import ColumnHeader from './ColumnHeader.svelte';
	import GridToolbar from './GridToolbar.svelte';
	import { reorderDestination } from '$lib/util/reorder';
	import {
		loadPersisted,
		savePersisted,
		GRID_WIDTHS_FILE,
		GRID_ORDER_FILE,
	} from '$lib/util/persist';

	interface Props {
		handle: DocHandle;
		path: Path;
		schema: ColumnSchema;
		
		onOpenInTree?: (cellPath: Path) => void;
		
		onCellSelect?: (cell: { path: Path; kind: NodeKind | null } | null) => void;
		
		docKey?: string | null;
		
		onExtract?: (values: unknown[]) => void;
	}

	let {
		handle,
		path,
		schema,
		onOpenInTree = () => {},
		onCellSelect = () => {},
		docKey = null,
		onExtract = () => {},
	}: Props = $props();

	const HEADER_HEIGHT = 26;
	const COL_OVERSCAN = 4;

	const filter = new GridFilterController({
		handle: () => handle,
		path: () => path,
		columns: () => schema.columns,
	});

	$effect(() => filter.coerceCappedOp());

	let colWidth: Map<string, number> = $state.raw(new Map());
	// 40px ≈ ~3 chars at the current mono font — narrow enough for a `#`
	// column but still hit-target friendly for the resize gripper.
	const MIN_COL_PX = 40;
	// 1200px keeps a wide column readable without letting one runaway field
	// push the rest off-screen on a 14" display.
	const MAX_COL_PX = 1200;

	let colOrder: string[] = $state.raw([]);
	const orderedColumns = $derived.by(() => {
		if (colOrder.length === 0) return schema.columns;
		const byKey = new Map(schema.columns.map((c) => [c.key, c]));
		const out: typeof schema.columns = [];
		for (const k of colOrder) {
			const c = byKey.get(k);
			if (c) {
				out.push(c);
				byKey.delete(k);
			}
		}
		for (const c of schema.columns) if (byKey.has(c.key)) out.push(c);
		return out;
	});

	const columnLayout = $derived(computeColumnLayout(orderedColumns, colWidth));

	let suppressSort = false;
	let resizeStartW = 0;

	function resizeColumn(key: string, dx: number) {
		const w = Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, resizeStartW + dx));
		colWidth = new Map(colWidth).set(key, w);
	}
	function autoFit(key: string) {
		const col = schema.columns.find((c) => c.key === key);
		if (!col) return;
		const w = autoFitWidthPx(col, data.loadedColumnTexts(key), MIN_COL_PX, MAX_COL_PX);
		colWidth = new Map(colWidth).set(key, w);
		persistWidths();
	}
	function onHeaderClick(key: string) {
		if (suppressSort) {
			suppressSort = false;
			return;
		}
		filter.toggleSort(key);
	}

	let headerEl: HTMLDivElement | undefined = $state();
	const COL_DRAG_THRESHOLD = 4;
	let colDrag = $state<{
		key: string;
		from: number;
		startX: number;
		lastX: number;
		moved: boolean;
		pid: number;
	} | null>(null);
	let colDropGap = $state<number | null>(null);

	
	function colContentX(clientX: number): number {
		if (!headerEl) return 0;
		return contentXFromClient(clientX, headerEl.getBoundingClientRect().left, data.scrollLeft);
	}

	function onColPointerDown(e: PointerEvent, key: string, i: number) {
		if (e.button !== 0) return;
		if ((e.target as Element).closest('.funnel, .col-resize')) return; // their gestures
		suppressSort = false;
		colDrag = { key, from: i, startX: e.clientX, lastX: e.clientX, moved: false, pid: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onColPointerMove(e: PointerEvent) {
		if (!colDrag || e.pointerId !== colDrag.pid) return;
		colDrag.lastX = e.clientX;
		if (!colDrag.moved && Math.abs(e.clientX - colDrag.startX) < COL_DRAG_THRESHOLD) return;
		colDrag.moved = true;
		suppressSort = true;
		colDropGap = gapForX(colContentX(e.clientX), columnLayout.offsets, columnLayout.widths);
		startAutoScroll();
	}
	function onColPointerUp(e: PointerEvent) {
		if (!colDrag || e.pointerId !== colDrag.pid) return;
		const moved = colDrag.moved;
		const key = colDrag.key;
		const gap = colDropGap;
		colDrag = null;
		colDropGap = null;
		stopAutoScroll();
		if (moved && gap !== null) moveColumn(key, gap);
	}
	function onColPointerCancel() {
		colDrag = null;
		colDropGap = null;
		stopAutoScroll();
	}

	const autoScroller = createAutoScroller({
		scroller: () => scroller,
		axis: 'horizontal',
		pointer: () => colDrag?.lastX ?? 0,
		active: () => !!colDrag?.moved && !!scroller,
		onTick: () => {
			if (!colDrag) return;
			colDropGap = gapForX(
				colContentX(colDrag.lastX),
				columnLayout.offsets,
				columnLayout.widths,
			);
		},
	});
	const startAutoScroll = () => autoScroller.start();
	const stopAutoScroll = () => autoScroller.stop();
	function moveColumn(key: string, gap: number) {
		const keys = orderedColumns.map((c) => c.key);
		const from = keys.indexOf(key);
		if (from < 0) return;
		const dest = reorderDestination(from, gap);
		if (dest === null) return;
		keys.splice(from, 1);
		keys.splice(dest, 0, key);
		colOrder = keys;
		persistOrder();
	}

	const indexWidth = $derived((Math.max(2, String(schema.rowCount).length) + 1.5) * PX_PER_CH);

	const data = new GridDataController({
		handle: () => handle,
		path: () => path,
		rowCount: () => schema.rowCount,
		query: () => filter.query,
		onFilterOverflow: filter.resetOnOverflow,
	});

	let scroller: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!scroller) return;
		data.setViewport(scroller.clientWidth, scroller.clientHeight);
		const ro = new ResizeObserver(() => {
			if (scroller) data.setViewport(scroller.clientWidth, scroller.clientHeight);
		});
		ro.observe(scroller);
		return () => ro.disconnect();
	});

	function onScroll(e: Event) {
		const el = e.currentTarget as HTMLDivElement;
		data.setScroll(el.scrollTop, el.scrollLeft);
		filter.closeDropdown();
	}

	const colWindow = $derived(
		columnWindow(columnLayout, data.scrollLeft, data.viewportWidth, COL_OVERSCAN),
	);

	$effect(() => {
		void data.chunks;
		void filter.query;
		data.fetchVisible();
	});

	$effect(() => {
		void handle;
		void schema;
		void filter.query;
		data.reset();
		if (scroller) {
			scroller.scrollTop = 0;
			scroller.scrollLeft = 0;
		}
		data.setScroll(0, 0);
	});

	$effect(() => {
		void handle;
		void schema;
		filter.resetValues();
	});

	const WIDTHS_FILE = GRID_WIDTHS_FILE;
	$effect(() => {
		void schema;
		const key = docKey;
		if (!key) {
			colWidth = new Map();
			return;
		}
		const ac = new AbortController();
		void loadPersisted<Record<string, number>>(WIDTHS_FILE, key).then((saved) => {
			if (ac.signal.aborted) return;
			colWidth = new Map(saved ? Object.entries(saved) : []);
		});
		return () => ac.abort();
	});

	function persistWidths() {
		if (docKey) void savePersisted(WIDTHS_FILE, docKey, Object.fromEntries(colWidth));
	}

	$effect(() => {
		void schema;
		const key = docKey;
		if (!key) {
			colOrder = [];
			return;
		}
		const ac = new AbortController();
		void loadPersisted<string[]>(GRID_ORDER_FILE, key).then((saved) => {
			if (ac.signal.aborted) return;
			colOrder = saved ?? [];
		});
		return () => ac.abort();
	});

	function persistOrder() {
		if (docKey) void savePersisted(GRID_ORDER_FILE, docKey, colOrder);
	}

	const selection = new GridSelectionController({
		data,
		handle: () => handle,
		path: () => path,
		onExtract: (values) => onExtract(values),
		onOpenInTree: (cellPath) => onOpenInTree(cellPath),
	});

	$effect(() => {
		void handle;
		void schema;
		void filter.query;
		selection.reset();
	});

	$effect(() => {
		const path = selection.selectedPath;
		onCellSelect(path ? { path, kind: selection.selectedKind } : null);
	});
</script>

<div class="grid-root">
	<GridToolbar
		bind:quick={filter.quick}
		groups={filter.groupColumns}
		activeGroup={filter.activeGroup}
		hasFilter={filter.hasFilter}
		filtering={filter.filtering}
		fetching={data.fetching}
		filteredTotal={data.filteredTotal}
		rowCount={schema.rowCount}
		colCount={schema.columns.length}
		sortKey={filter.sortKey}
		sortDesc={filter.sortDesc}
		onClearColumnIn={filter.clearColumnIn}
		onClearAll={filter.clearAll}
		onAddGroup={filter.addGroup}
		onRemoveGroup={filter.removeGroup}
		onSetActiveGroup={filter.setActiveGroup}
	/>

	{#if filter.sortError}
		<div class="banner banner-err" role="status">filter unavailable: {filter.sortError}</div>
	{/if}

	{#if selection.selectedRows.size > 0}
		<div class="sel-bar">
			<span class="sel-count"
				>{selection.selectedRows.size} row{selection.selectedRows.size === 1 ? '' : 's'} selected</span
			>
			<span class="grow"></span>
			<button class="sel-btn" onclick={selection.copySelected}
				>{selection.rowsCopy.done ? 'copied' : 'copy JSON'}</button
			>
			<button class="sel-btn" onclick={selection.extractSelected}>extract to tab ↗</button>
			<button class="sel-btn" onclick={selection.clearSelection}>clear</button>
		</div>
	{/if}

	
	<div class="top" style="height: {HEADER_HEIGHT}px;">
		<div class="corner" style="width: {indexWidth}px;" aria-hidden="true">#</div>
		<div class="header" bind:this={headerEl}>
			<div
				class="header-track"
				style="width: {columnLayout.total}px; transform: translateX(-{data.scrollLeft}px);"
			>
				{#if colDropGap !== null}
					<div
						class="col-drop-line"
						style="left: {colDropGap < orderedColumns.length
							? columnLayout.offsets[colDropGap]
							: columnLayout.total}px;"
					></div>
				{/if}
				{#each orderedColumns as col, i (col.key)}
					{#if i >= colWindow.start && i < colWindow.end}
						<ColumnHeader
							{col}
							left={columnLayout.offsets[i]}
							width={columnLayout.widths[i]}
							active={filter.sortKey === col.key}
							sortDesc={filter.sortDesc}
							hasFilter={filter.colFilters.has(col.key)}
							dragging={colDrag?.key === col.key}
							onClick={() => onHeaderClick(col.key)}
							onPointerDown={(e) => onColPointerDown(e, col.key, i)}
							onPointerMove={onColPointerMove}
							onPointerUp={onColPointerUp}
							onPointerCancel={onColPointerCancel}
							onOpenFilter={(e) => filter.openFilter(e, col.key)}
							onResizeStart={() => {
								suppressSort = true;
								resizeStartW = columnLayout.widths[i];
							}}
							onResizeMove={(dx) => resizeColumn(col.key, dx)}
							onResizeEnd={(moved) => {
								if (moved) persistWidths();
							}}
							onAutoFit={() => autoFit(col.key)}
						/>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	
	<div class="body">
		<div class="index-gutter" style="width: {indexWidth}px;">
			<div class="index-track" style="transform: translateY(-{data.scrollTop}px);">
				{#each data.visibleRows as rowIdx (rowIdx)}
					{@const row = data.getRow(rowIdx)}
					<button
						class="index-cell"
						class:zebra={rowIdx % 2 === 1}
						class:row-selected={selection.rowSelected(row?.index)}
						style="top: {rowIdx * ROW_HEIGHT}px; height: {ROW_HEIGHT}px;"
						title="Click to select · shift-click for range"
						onclick={(e) => row && selection.onIndexClick(e, rowIdx, row.index)}
						>{row ? row.index : ''}</button
					>
				{/each}
			</div>
		</div>

		<div bind:this={scroller} class="scroller" onscroll={onScroll}>
			<div
				class="content"
				style="width: {columnLayout.total}px; height: {data.effectiveRowCount * ROW_HEIGHT}px;"
			>
				{#each data.visibleRows as rowIdx (rowIdx)}
					<div
						class="row"
						class:zebra={rowIdx % 2 === 1}
						class:row-selected={selection.rowSelected(data.getRow(rowIdx)?.index)}
						style="top: {rowIdx *
							ROW_HEIGHT}px; height: {ROW_HEIGHT}px; width: {columnLayout.total}px;"
					>
						{#each orderedColumns as col, i (col.key)}
							{#if i >= colWindow.start && i < colWindow.end}
								{@const v = data.getCell(rowIdx, col.key)}
								<div
									class={cellClass(v)}
									class:selected={selection.selected?.row === rowIdx &&
										selection.selected?.col === col.key}
									style="left: {columnLayout.offsets[i]}px; width: {columnLayout.widths[i]}px;"
									title={cellTitle(v)}
									role="button"
									tabindex="0"
									onclick={() => selection.selectCell(rowIdx, col.key)}
									onkeydown={(e) => selection.onCellKeydown(e, rowIdx, col.key)}
								>
									{cellRender(v)}
								</div>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	{#if selection.selected}
		<CellInspector
			value={selection.selectedValue}
			location={`[${data.getRow(selection.selected.row)?.index ?? selection.selected.row}] · ${selection.selected.col}`}
			copied={selection.inspectorCopy.done}
			onCopy={selection.copyInspector}
			onOpenInTree={selection.openSelectedInTree}
		/>
	{/if}
</div>

{#if filter.openCol}
	{@const key = filter.openCol}
	<ColumnFilterPopover
		anchor={filter.openAnchor}
		anchorEl={filter.openAnchorEl}
		bind:valueSearch={filter.valueSearch}
		view={{
			key,
			kind: filter.colKind(key),
			op: filter.openOp,
			opChoices: filter.openOpChoices,
			listMode: filter.openListMode,
			distinctValues: filter.openValues?.values ?? null,
			capped: filter.openValues?.capped ?? false,
			current: filter.colFilters.get(key),
			searchable: (filter.valuesByCol.get(key)?.values.length ?? 0) > 8,
		}}
		actions={{
			close: () => filter.closeDropdown(),
			clear: () => filter.clearColumn(key),
			updateCol: (patch) => filter.updateCol(key, patch),
			setOp: filter.setOpenOp,
			setText: (text) => filter.setText(key, text),
			toggleValue: (value) => filter.toggleValue(key, value),
			setPresence: (p) => filter.setPresence(key, p),
			isChecked: (value) => filter.isChecked(key, value),
		}}
	/>
{/if}

<style>
	.grid-root {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text);
	}

	.sel-bar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.75rem;
		background: var(--accent-soft);
		border-bottom: 1px solid var(--accent-line);
		font-size: 11.5px;
	}
	.sel-count {
		color: var(--accent);
		font-weight: 600;
	}
	.sel-btn {
		background: transparent;
		border: 1px solid var(--rule-2);
		color: var(--text-dim);
		font-size: 11px;
		padding: 0.1rem 0.6ch;
		cursor: pointer;
		white-space: nowrap;
	}
	.sel-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.top {
		flex: 0 0 auto;
		display: flex;
		border-bottom: 1px solid var(--rule);
		background: var(--bg-elev);
	}
	.corner {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-faint);
		font-size: 11px;
		border-right: 1px solid var(--rule-2);
	}
	.header {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		position: relative;
	}
	.header-track {
		position: relative;
		height: 100%;
	}
	
	.col-drop-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--accent);
		pointer-events: none;
		z-index: 3;
		transform: translateX(-1px);
	}

	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		min-width: 0;
	}
	.index-gutter {
		flex: 0 0 auto;
		position: relative;
		overflow: hidden;
		background: var(--bg-elev);
		border-right: 1px solid var(--rule-2);
	}
	.index-track {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
	}
	.index-cell {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 0 0.6ch;
		color: var(--text-faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		background: transparent;
		border: none;
		font-family: var(--font-mono);
		cursor: pointer;
	}
	.index-cell.zebra {
		background: rgba(255, 255, 255, 0.025);
	}
	.index-cell:hover {
		color: var(--text-dim);
		background: var(--bg-elev-2);
	}
	.index-cell.row-selected {
		color: var(--accent);
		background: var(--accent-soft);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.scroller {
		flex: 1;
		overflow: auto;
		min-height: 0;
		min-width: 0;
	}
	.content {
		position: relative;
	}

	.row {
		position: absolute;
		left: 0;
	}
	.row.zebra {
		background: rgba(255, 255, 255, 0.025);
	}
	.row:hover {
		background: var(--accent-soft);
	}
	.row.row-selected {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 9999px var(--accent-soft);
	}

	.cell {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		padding: 0 0.6ch;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		border-right: 1px solid var(--rule);
	}
	.cell.right {
		justify-content: flex-end;
	}
	.cell.string {
		color: var(--text);
	}
	.cell.number {
		color: var(--syntax-number);
	}
	.cell.bool {
		color: var(--syntax-boolean);
	}
	.cell.null {
		color: var(--syntax-null);
	}
	.cell.object,
	.cell.array {
		color: var(--text-dim);
	}
	.cell.unloaded {
		color: var(--text-faint);
	}
	.cell.missing {
		color: transparent;
	}
	.cell[role='button'] {
		cursor: pointer;
	}
	.cell.selected {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
</style>
