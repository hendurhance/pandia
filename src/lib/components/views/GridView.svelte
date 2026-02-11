<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from '../ui/Icon.svelte';
	import NestedGridCell from './NestedGridCell.svelte';

	type GridRow = Record<string, unknown>;

	interface Props {
		data: GridRow[];
		onClose?: () => void;
	}

	let { data, onClose }: Props = $props();

	// State
	let expandedPaths: Set<string> = $state(new Set());
	let sortColumn: string | null = $state(null);
	let sortDirection: 'asc' | 'desc' = $state('asc');
	let filterColumn: string | null = $state(null);
	let filterValue: string = $state('');
	let showFilterInput: boolean = $state(false);
	let copiedCell: string | null = $state(null);

	// Virtual scrolling state
	let scrollContainer: HTMLDivElement | null = $state(null);
	let scrollTop: number = $state(0);
	let containerHeight: number = $state(600);
	const ROW_HEIGHT = 44; // Fixed row height for virtualization
	const BUFFER_ROWS = 5; // Extra rows to render above/below viewport

	// Column resizing state
	let columnWidths: Map<string, number> = $state(new Map());
	let resizingColumn: string | null = $state(null);
	let resizeStartX: number = $state(0);
	let resizeStartWidth: number = $state(0);

	// Filter input ref
	let filterInputRef: HTMLInputElement | null = $state(null);
	const DEFAULT_COLUMN_WIDTH = 280; // Wider default for UUIDs
	const MIN_COLUMN_WIDTH = 100;
	const MAX_COLUMN_WIDTH = 600;

	// Get all column keys from the first row
	let columns: string[] = $derived(
		data.length > 0 ? Object.keys(data[0]) : []
	);

	// Initialize column widths
	$effect(() => {
		if (columns.length > 0 && columnWidths.size === 0) {
			const newWidths = new Map<string, number>();
			columns.forEach(col => {
				newWidths.set(col, DEFAULT_COLUMN_WIDTH);
			});
			columnWidths = newWidths;
		}
	});

	// Filter and sort data
	let processedData = $derived.by(() => {
		let result = [...data];

		// Apply filter
		if (filterColumn && filterValue.trim()) {
			const searchTerm = filterValue.toLowerCase().trim();
			const col = filterColumn;
			result = result.filter((row) => {
				const cellValue = row[col];
				const stringValue = typeof cellValue === 'object'
					? JSON.stringify(cellValue)
					: String(cellValue ?? '');
				return stringValue.toLowerCase().includes(searchTerm);
			});
		}

		// Apply sort
		if (sortColumn) {
			const col = sortColumn;
			const dir = sortDirection;
			result.sort((a, b) => {
				const aVal = a[col];
				const bVal = b[col];

				if (aVal == null && bVal == null) return 0;
				if (aVal == null) return dir === 'asc' ? -1 : 1;
				if (bVal == null) return dir === 'asc' ? 1 : -1;

				if (typeof aVal === 'number' && typeof bVal === 'number') {
					return dir === 'asc' ? aVal - bVal : bVal - aVal;
				}

				const aStr = typeof aVal === 'object' ? JSON.stringify(aVal) : String(aVal);
				const bStr = typeof bVal === 'object' ? JSON.stringify(bVal) : String(bVal);
				const comparison = aStr.localeCompare(bStr);
				return dir === 'asc' ? comparison : -comparison;
			});
		}

		return result;
	});

	// Check if virtual scrolling should be used
	// Disable when cells are expanded (variable row heights) or small datasets
	let useVirtualScroll = $derived(
		expandedPaths.size === 0 && processedData.length > 50
	);

	// Virtual scrolling calculations
	let virtualScrollInfo = $derived.by(() => {
		const totalRows = processedData.length;

		// When not using virtual scroll, render all rows
		if (!useVirtualScroll) {
			return {
				totalHeight: 'auto',
				startIndex: 0,
				endIndex: totalRows,
				offsetY: 0,
				visibleData: processedData
			};
		}

		const totalHeight = totalRows * ROW_HEIGHT;
		const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
		const visibleRows = Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
		const endIndex = Math.min(totalRows, startIndex + visibleRows);
		const offsetY = startIndex * ROW_HEIGHT;

		return {
			totalHeight,
			startIndex,
			endIndex,
			offsetY,
			visibleData: processedData.slice(startIndex, endIndex)
		};
	});

	function handleScroll(e: Event) {
		const target = e.target as HTMLDivElement;
		scrollTop = target.scrollTop;
	}

	function getColumnWidth(column: string): number {
		return columnWidths.get(column) ?? DEFAULT_COLUMN_WIDTH;
	}

	function startResize(column: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		resizingColumn = column;
		resizeStartX = e.clientX;
		resizeStartWidth = getColumnWidth(column);

		document.addEventListener('mousemove', handleResizeMove);
		document.addEventListener('mouseup', stopResize);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	function handleResizeMove(e: MouseEvent) {
		if (!resizingColumn) return;

		const delta = e.clientX - resizeStartX;
		const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, resizeStartWidth + delta));

		const newWidths = new Map(columnWidths);
		newWidths.set(resizingColumn, newWidth);
		columnWidths = newWidths;
	}

	function stopResize() {
		resizingColumn = null;
		document.removeEventListener('mousemove', handleResizeMove);
		document.removeEventListener('mouseup', stopResize);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	// Cleanup resize listeners if component unmounts during resize
	onDestroy(() => {
		if (resizingColumn !== null) {
			document.removeEventListener('mousemove', handleResizeMove);
			document.removeEventListener('mouseup', stopResize);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		}
	});

	function toggleExpandedPath(path: string) {
		const newPaths = new Set(expandedPaths);
		if (newPaths.has(path)) {
			newPaths.delete(path);
		} else {
			newPaths.add(path);
		}
		expandedPaths = newPaths;
	}

	function expandAll() {
		const paths = new Set<string>();
		function collectPaths(val: unknown, prefix: string) {
			if (val === null || typeof val !== 'object') return;
			paths.add(prefix);
			if (Array.isArray(val)) {
				val.forEach((item, idx) => {
					collectPaths(item, `${prefix}[${idx}]`);
				});
			} else {
				Object.entries(val as Record<string, unknown>).forEach(([key, v]) => {
					collectPaths(v, `${prefix}.${key}`);
				});
			}
		}
		data.forEach((row, rowIdx) => {
			Object.entries(row as Record<string, unknown>).forEach(([key, val]) => {
				collectPaths(val, `row${rowIdx}.${key}`);
			});
		});
		expandedPaths = paths;
	}

	function collapseAll() {
		expandedPaths = new Set();
	}

	function handleSort(column: string) {
		if (sortColumn === column) {
			if (sortDirection === 'asc') {
				sortDirection = 'desc';
			} else {
				sortColumn = null;
				sortDirection = 'asc';
			}
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
	}

	function handleFilterClick(column: string) {
		if (filterColumn === column && showFilterInput) {
			showFilterInput = false;
			filterColumn = null;
			filterValue = '';
		} else {
			filterColumn = column;
			showFilterInput = true;
		}
	}

	function clearFilter() {
		filterColumn = null;
		filterValue = '';
		showFilterInput = false;
	}

	async function copyCell(value: unknown, cellId: string) {
		const textToCopy = typeof value === 'object'
			? JSON.stringify(value, null, 2)
			: String(value ?? '');

		try {
			await navigator.clipboard.writeText(textToCopy);
			copiedCell = cellId;
			setTimeout(() => {
				copiedCell = null;
			}, 1500);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	// Calculate total table width
	let totalTableWidth = $derived.by(() => {
		let width = 60; // Row index column
		columns.forEach(col => {
			width += getColumnWidth(col);
		});
		return width;
	});

	// Focus filter input when shown
	$effect(() => {
		if (showFilterInput && filterInputRef) {
			filterInputRef.focus();
		}
	});
</script>

<div class="grid-view" role="grid" aria-label="JSON data grid">
	<div class="grid-header">
		<div class="grid-header-left">
			<Icon name="table-view" size={16} />
			<h3>Grid View</h3>
			<span class="grid-row-count">
				{processedData.length} {processedData.length === 1 ? 'row' : 'rows'}
				{#if filterValue && processedData.length !== data.length}
					<span class="filtered-indicator">(filtered from {data.length})</span>
				{/if}
			</span>
		</div>
		<div class="grid-header-actions">
			{#if data.length > 0}
				<button
					class="grid-action-btn"
					onclick={expandAll}
					title="Expand all nested objects"
				>
					<Icon name="expand" size={14} />
					<span>Expand</span>
				</button>
				<button
					class="grid-action-btn"
					onclick={collapseAll}
					title="Collapse all nested objects"
				>
					<Icon name="collapse" size={14} />
					<span>Collapse</span>
				</button>
			{/if}
			<button
				class="grid-close-btn"
				onclick={onClose}
				aria-label="Close grid view"
				title="Switch to Tree View"
			>
				<Icon name="close" size={14} />
			</button>
		</div>
	</div>

	{#if showFilterInput && filterColumn}
		<div class="filter-bar">
			<div class="filter-content">
				<Icon name="filter" size={14} />
				<span class="filter-label">Filter by <strong>{filterColumn}</strong>:</span>
				<input
					bind:this={filterInputRef}
					type="text"
					class="filter-input"
					placeholder="Type to filter..."
					bind:value={filterValue}
					autocapitalize="off" 
					spellcheck="false"
				/>
				<button class="filter-clear-btn" onclick={clearFilter} title="Clear filter">
					<Icon name="close" size={12} />
				</button>
			</div>
		</div>
	{/if}

	{#if processedData.length > 0}
		<div
			class="grid-wrapper"
			bind:this={scrollContainer}
			bind:clientHeight={containerHeight}
			onscroll={handleScroll}
		>
			<div class="virtual-scroll-container" style="height: {useVirtualScroll ? virtualScrollInfo.totalHeight + 'px' : 'auto'}; min-width: {totalTableWidth}px;">
				<!-- Sticky header -->
				<div class="table-header" style="min-width: {totalTableWidth}px;">
					<div class="header-row">
						<div class="row-index-header">#</div>
						{#each columns as column}
							<div
								class="sortable-header"
								style="width: {getColumnWidth(column)}px; min-width: {getColumnWidth(column)}px;"
							>
								<div class="th-content">
									<span class="th-text" title={column}>{column}</span>
									<div class="th-actions">
										<button
											class="th-action-btn"
											class:active={sortColumn === column}
											onclick={() => handleSort(column)}
											title={sortColumn === column
												? (sortDirection === 'asc' ? 'Sort descending' : 'Clear sort')
												: 'Sort ascending'}
										>
											{#if sortColumn === column}
												<Icon name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} />
											{:else}
												<Icon name="sort" size={12} />
											{/if}
										</button>
										<button
											class="th-action-btn"
											class:active={filterColumn === column && showFilterInput}
											onclick={() => handleFilterClick(column)}
											title="Filter by this column"
										>
											<Icon name="filter" size={12} />
										</button>
									</div>
								</div>
								<!-- Resize handle -->
								<button
									class="resize-handle"
									class:resizing={resizingColumn === column}
									onmousedown={(e) => startResize(column, e)}
									aria-label="Resize column {column}"
									tabindex="-1"
								></button>
							</div>
						{/each}
					</div>
				</div>

				<!-- Virtual rows -->
				<div
					class="table-body"
					style="transform: translateY({virtualScrollInfo.offsetY}px); min-width: {totalTableWidth}px;"
				>
					{#each virtualScrollInfo.visibleData as row, localIndex}
						{@const actualIndex = virtualScrollInfo.startIndex + localIndex}
						<div
							class="data-row"
							class:row-even={actualIndex % 2 === 0}
							class:row-odd={actualIndex % 2 !== 0}
							style="min-height: {useVirtualScroll ? ROW_HEIGHT : 44}px;"
						>
							<div class="row-index">{actualIndex + 1}</div>
							{#each columns as column}
								{@const cellId = `row${actualIndex}.${column}`}
								{@const value = row[column]}
								<div
									class="data-cell"
									style="width: {getColumnWidth(column)}px; min-width: {getColumnWidth(column)}px;"
								>
									<div class="cell-wrapper">
										<div class="cell-content">
											<NestedGridCell
												{value}
												depth={0}
												maxDepth={10}
												{expandedPaths}
												path={cellId}
												onToggle={toggleExpandedPath}
											/>
										</div>
										<button
											class="copy-btn"
											class:copied={copiedCell === cellId}
											onclick={() => copyCell(value, cellId)}
											title={copiedCell === cellId ? 'Copied!' : 'Copy value'}
										>
											<Icon name={copiedCell === cellId ? 'success' : 'copy'} size={12} />
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{:else if data.length > 0 && filterValue}
		<div class="grid-empty">
			<Icon name="filter" size={32} />
			<p>No results match your filter</p>
			<button class="clear-filter-btn" onclick={clearFilter}>Clear filter</button>
		</div>
	{:else}
		<div class="grid-empty">
			<Icon name="info" size={32} />
			<p>No data to display</p>
			<span class="grid-empty-hint">Grid view works best with arrays of objects</span>
		</div>
	{/if}
</div>

<style>
	.grid-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface);
		overflow: hidden;
	}

	.grid-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.grid-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.grid-header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
	}

	.grid-row-count {
		font-size: 12px;
		color: var(--color-text-muted);
		background: var(--color-surface);
		padding: 2px 8px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}

	.filtered-indicator {
		color: var(--color-primary);
		margin-left: 4px;
	}

	.grid-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.grid-action-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.15s ease;
	}

	.grid-action-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
		border-color: var(--color-border-focus);
	}

	.grid-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.grid-close-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	/* Filter bar */
	.filter-bar {
		padding: 8px 16px;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.filter-content {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.filter-label {
		color: var(--color-text-muted);
	}

	.filter-label strong {
		color: var(--color-primary);
	}

	.filter-input {
		flex: 1;
		max-width: 300px;
		padding: 6px 10px;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-surface-secondary);
		color: var(--color-text);
		font-size: 13px;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.filter-input:focus {
		border-color: var(--color-primary);
	}

	.filter-input::placeholder {
		color: var(--color-text-muted);
	}

	.filter-clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-clear-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	/* Virtual scroll wrapper */
	.grid-wrapper {
		flex: 1;
		overflow: auto;
		background: var(--color-surface);
		position: relative;
	}

	.virtual-scroll-container {
		position: relative;
	}

	/* Header styles */
	.table-header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.header-row {
		display: flex;
		align-items: stretch;
	}

	.row-index-header {
		width: 60px;
		min-width: 60px;
		max-width: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 10px 8px;
		background: var(--color-surface-secondary);
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 13px;
		border-right: 1px solid var(--color-border-secondary);
		position: sticky;
		left: 0;
		z-index: 11;
	}

	.sortable-header {
		display: flex;
		align-items: center;
		padding: 10px 12px;
		background: var(--color-surface-secondary);
		color: var(--color-text);
		font-weight: 600;
		font-size: 13px;
		border-right: 1px solid var(--color-border-secondary);
		position: relative;
		box-sizing: border-box;
	}

	.sortable-header:last-child {
		border-right: none;
	}

	.th-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding-right: 8px;
	}

	.th-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.th-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0.6;
		transition: opacity 0.15s ease;
		flex-shrink: 0;
	}

	.sortable-header:hover .th-actions {
		opacity: 1;
	}

	.th-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.th-action-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.th-action-btn.active {
		background: var(--color-primary);
		color: white;
	}

	/* Resize handle */
	.resize-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 6px;
		padding: 0;
		border: none;
		cursor: col-resize;
		background: transparent;
		transition: background 0.15s ease;
		z-index: 1;
	}

	.resize-handle:hover,
	.resize-handle.resizing {
		background: var(--color-primary);
	}

	.resize-handle::after {
		content: '';
		position: absolute;
		right: 2px;
		top: 50%;
		transform: translateY(-50%);
		width: 2px;
		height: 16px;
		background: var(--color-border);
		border-radius: 1px;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.sortable-header:hover .resize-handle::after,
	.resize-handle.resizing::after {
		opacity: 1;
	}

	/* Table body */
	.table-body {
		position: relative;
		will-change: transform;
	}

	.data-row {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--color-border-secondary);
		transition: background-color 0.1s ease;
	}

	.data-row:hover {
		background: var(--color-surface-hover) !important;
	}

	.data-row:hover .row-index {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.row-even {
		background: var(--color-surface);
	}

	.row-odd {
		background: rgba(255, 255, 255, 0.02);
	}

	.row-index {
		width: 60px;
		min-width: 60px;
		max-width: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 500;
		background: var(--color-surface-secondary);
		border-right: 1px solid var(--color-border);
		position: sticky;
		left: 0;
		z-index: 1;
	}

	.data-cell {
		display: flex;
		align-items: flex-start;
		border-right: 1px solid var(--color-border-secondary);
		box-sizing: border-box;
		overflow: hidden;
	}

	.data-cell:last-child {
		border-right: none;
	}

	.cell-wrapper {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		padding: 10px 12px;
		width: 100%;
		min-width: 0;
	}

	.cell-content {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 13px;
		line-height: 1.4;
	}

	.copy-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: 3px;
		cursor: pointer;
		opacity: 0;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.cell-wrapper:hover .copy-btn {
		opacity: 1;
	}

	.copy-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.copy-btn.copied {
		opacity: 1;
		color: var(--color-success);
	}

	/* Empty states */
	.grid-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 200px;
		gap: 12px;
		color: var(--color-text-muted);
		padding: 40px;
	}

	.grid-empty p {
		margin: 0;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.grid-empty-hint {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.clear-filter-btn {
		margin-top: 8px;
		padding: 6px 16px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		transition: all 0.15s ease;
	}

	.clear-filter-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}
</style>
