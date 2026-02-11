<script lang="ts">
	import { onDestroy } from 'svelte';
	import { currentTab, tabs } from '$lib/stores/tabs';
	import { jsonUtils, type JSONStats } from '$lib/services/json';
	import { showSchemaModal } from '$lib/stores/validation';
	import { historyManager } from '$lib/stores/history';
	import Icon from '../ui/Icon.svelte';
	import { sortObjectKeys, flatten, unflatten, maskSensitiveData } from '$lib/utils/transform';
	import { BYTES } from '$lib/constants';

	let {
		openCompare,
		openExport,
		openImport,
		openJSONRepair,
		openPathFinder,
		openQueryJSON,
		openSnippetManager,
		openBatchOperations,
		openAdvancedVisualizer,
		openTypeGenerator
	}: {
		openCompare?: () => void;
		openExport?: () => void;
		openImport?: () => void;
		openJSONRepair?: () => void;
		openPathFinder?: () => void;
		openQueryJSON?: () => void;
		openSnippetManager?: () => void;
		openBatchOperations?: () => void;
		openAdvancedVisualizer?: () => void;
		openTypeGenerator?: () => void;
	} = $props();

	let sidebarWidth = $state(250);
	let isResizing = $state(false);
	let isCollapsed = $state(false);
	let activePanel = $state('tools');
	let jsonStats: JSONStats | null = $state(null);
	let customTransform = $state('');

	let isCompareTab = $derived($currentTab?.type === 'compare');
	let hasEditableTab = $derived($currentTab && !isCompareTab);

	function toggleCollapse() {
		isCollapsed = !isCollapsed;
	}

	function handleOpenPathFinder() {
		openPathFinder?.();
	}

	function handleOpenQueryJSON() {
		openQueryJSON?.();
	}

	function handleOpenExport() {
		openExport?.();
	}

	function handleOpenImport() {
		openImport?.();
	}

	function handleOpenSnippetManager() {
		openSnippetManager?.();
	}

	function handleOpenBatchOperations() {
		openBatchOperations?.();
	}

	function handleOpenJSONRepair() {
		openJSONRepair?.();
	}

	function handleOpenAdvancedVisualizer() {
		openAdvancedVisualizer?.();
	}

	function handleOpenTypeGenerator() {
		openTypeGenerator?.();
	}

	$effect(() => {
		if ($currentTab?.content && $currentTab?.type !== 'compare') {
			updateStats($currentTab.content);
		} else {
			jsonStats = null;
		}
	});

	async function updateStats(content: string) {
		try {
			jsonStats = await jsonUtils.getStats(content);
		} catch (error) {
			jsonStats = null;
		}
	}

	function startResize(event: MouseEvent) {
		isResizing = true;
		document.addEventListener('mousemove', handleResize);
		document.addEventListener('mouseup', stopResize);
		event.preventDefault();
	}

	function handleResize(event: MouseEvent) {
		if (isResizing) {
			sidebarWidth = Math.max(200, Math.min(400, event.clientX));
		}
	}

	function stopResize() {
		isResizing = false;
		document.removeEventListener('mousemove', handleResize);
		document.removeEventListener('mouseup', stopResize);
	}

	onDestroy(() => {
		if (isResizing) {
			document.removeEventListener('mousemove', handleResize);
			document.removeEventListener('mouseup', stopResize);
		}
	});

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = BYTES.KB;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function showSchemaValidation() {
		showSchemaModal.set(true);
	}

	function showCompareFiles() {
		openCompare?.();
	}

	function showHistoryDiff() {
		if (!$currentTab) return;
		const history = historyManager.getHistoryInfo($currentTab.id);
		if (history.total < 2) {
			alert('No history available for comparison');
			return;
		}
		alert(`History has ${history.total} states. Feature coming soon!`);
	}

	async function sortKeys() {
		if (!$currentTab) return;
		try {
			const json = JSON.parse($currentTab.content);
			const sorted = sortObjectKeys(json);
			tabs.updateContent($currentTab.id, JSON.stringify(sorted, null, 2));
		} catch (error) {
			alert(`Failed to sort keys: ${error}`);
		}
	}

	async function flattenObject() {
		if (!$currentTab) return;
		try {
			const json = JSON.parse($currentTab.content);
			const flattened = flatten(json);
			tabs.updateContent($currentTab.id, JSON.stringify(flattened, null, 2));
		} catch (error) {
			alert(`Failed to flatten object: ${error}`);
		}
	}

	async function unflattenObject() {
		if (!$currentTab) return;
		try {
			const json = JSON.parse($currentTab.content);
			const unflattened = unflatten(json);
			tabs.updateContent($currentTab.id, JSON.stringify(unflattened, null, 2));
		} catch (error) {
			alert(`Failed to unflatten object: ${error}`);
		}
	}

	async function maskSecrets() {
		if (!$currentTab) return;
		try {
			const json = JSON.parse($currentTab.content);
			const masked = maskSensitiveData(json);
			tabs.updateContent($currentTab.id, JSON.stringify(masked, null, 2));
		} catch (error) {
			alert(`Failed to mask secrets: ${error}`);
		}
	}

	async function applyCustomTransform() {
		if (!$currentTab || !customTransform.trim()) return;
		try {
			const json = JSON.parse($currentTab.content);
			const transformFunction = new Function('data', customTransform);
			const result = transformFunction(json);
			tabs.updateContent($currentTab.id, JSON.stringify(result, null, 2));
		} catch (error) {
			alert(`Transform failed: ${error}`);
		}
	}

</script>

<div class="sidebar {isCollapsed ? 'collapsed' : ''}" style="width: {isCollapsed ? '48px' : sidebarWidth + 'px'}">
	<div class="sidebar-header">
		<button 
			class="collapse-btn" 
			onclick={toggleCollapse}
			title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
			aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
		>
			<Icon name={isCollapsed ? 'expand-sidebar' : 'collapse'} size={16} />
		</button>
		{#if !isCollapsed}
			<div class="tab-buttons">
				<button 
					class="tab-btn {activePanel === 'tools' ? 'active' : ''}"
					onclick={() => activePanel = 'tools'}
				>
					Tools
				</button>
				<button 
					class="tab-btn {activePanel === 'stats' ? 'active' : ''}"
					onclick={() => activePanel = 'stats'}
				>
					Stats
				</button>
				<button 
					class="tab-btn {activePanel === 'transform' ? 'active' : ''}"
					onclick={() => activePanel = 'transform'}
				>
					Transform
				</button>
			</div>
		{/if}
	</div>

	<div class="sidebar-content">
		{#if isCollapsed}
			<!-- Collapsed sidebar with icon-only buttons -->
			<div class="collapsed-tools">
				<button class="collapsed-tool-btn" onclick={handleOpenImport} title="Import JSON" aria-label="Import JSON">
					<Icon name="import" size={16} />
				</button>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenExport} title="Export JSON" aria-label="Export JSON">
					<Icon name="export" size={16} />
				</button>
				<div class="divider" role="separator"></div>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenPathFinder} title="JSONPath Finder" aria-label="JSONPath Finder">
					<Icon name="search" size={16} />
				</button>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenQueryJSON} title="Query JSON" aria-label="Query JSON">
					<Icon name="query" size={16} />
				</button>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenJSONRepair} title="Repair JSON" aria-label="Repair JSON">
					<Icon name="repair" size={16} />
				</button>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenAdvancedVisualizer} title="Graph Visualizer" aria-label="Graph Visualizer">
					<Icon name="visualize" size={16} />
				</button>
				<button class="collapsed-tool-btn" disabled={!hasEditableTab} onclick={handleOpenTypeGenerator} title="Generate Types" aria-label="Generate Types">
					<Icon name="code" size={16} />
				</button>
				<button class="collapsed-tool-btn" onclick={handleOpenSnippetManager} title="Snippet Manager" aria-label="Snippet Manager">
					<Icon name="package" size={16} />
				</button>
				<button class="collapsed-tool-btn" onclick={handleOpenBatchOperations} title="Batch Operations" aria-label="Batch Operations">
					<Icon name="batch" size={16} />
				</button>
			</div>
		{:else if activePanel === 'tools'}
			<div class="panel">
				<h3>File Operations</h3>
				<div class="tool-group">
					<button class="tool-btn primary" onclick={handleOpenImport}>
						<Icon name="import" size={16} />
						Import JSON
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenExport}>
						<Icon name="export" size={16} />
						Export JSON
					</button>
				</div>

				<h3>JSON Tools</h3>
				<div class="tool-group">
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenPathFinder}>
						<Icon name="search" size={14} />
						JSONPath Finder
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenQueryJSON}>
						<Icon name="query" size={14} />
						Query JSON
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenJSONRepair}>
						<Icon name="repair" size={14} />
						Repair JSON
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={showSchemaValidation}>
						<Icon name="validate" size={14} />
						Schema Validate
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenAdvancedVisualizer}>
						<Icon name="visualize" size={14} />
						Graph Visualizer
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={handleOpenTypeGenerator}>
						<Icon name="code" size={14} />
						Generate Types
					</button>
				</div>

				<h3>Compare</h3>
				<div class="tool-group">
					<button class="tool-btn" onclick={showCompareFiles}>
						<Icon name="compare" size={14} />
						Compare Files
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={showHistoryDiff}>
						<Icon name="history" size={14} />
						History Diff
					</button>
				</div>

				<h3>Advanced</h3>
				<div class="tool-group">
					<button class="tool-btn" onclick={handleOpenSnippetManager}>
						<Icon name="package" size={14} />
						Snippet Manager
					</button>
					<button class="tool-btn" onclick={handleOpenBatchOperations}>
						<Icon name="batch" size={14} />
						Batch Operations
					</button>
				</div>
			</div>
		{:else if activePanel === 'stats'}
			<div class="panel">
				<h3>JSON Statistics</h3>
				{#if jsonStats && hasEditableTab}
					<div class="stats-grid">
						<div class="stat-item">
							<div class="stat-label">Size (Raw)</div>
							<span>{formatBytes(jsonStats.raw)}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Size (Gzip)</div>
							<span>{formatBytes(jsonStats.gzip)}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Size (Brotli)</div>
							<span>{formatBytes(jsonStats.brotli)}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Objects</div>
							<span>{jsonStats.objects || 0}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Arrays</div>
							<span>{jsonStats.arrays || 0}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Keys</div>
							<span>{jsonStats.keys || 0}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Max Depth</div>
							<span>{jsonStats.depth || 0}</span>
						</div>
						<div class="stat-item">
							<div class="stat-label">Lines</div>
							<span>{jsonStats.lines || 0}</span>
						</div>
					</div>
				{:else}
					<p class="no-data">No JSON loaded</p>
				{/if}
			</div>
		{:else if activePanel === 'transform'}
			<div class="panel">
				<h3>Transformations</h3>
				<div class="tool-group">
					<button class="tool-btn" disabled={!hasEditableTab} onclick={sortKeys}>
						<Icon name="sort" size={14} />
						Sort Keys
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={flattenObject}>
						<Icon name="flatten" size={14} />
						Flatten Object
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={unflattenObject}>
						<Icon name="expand" size={14} />
						Unflatten Object
					</button>
					<button class="tool-btn" disabled={!hasEditableTab} onclick={maskSecrets}>
						<Icon name="eye-off" size={14} />
						Mask Secrets
					</button>
				</div>

				<h3>Custom Transform</h3>
				<textarea 
					class="transform-input" 
					placeholder="Enter JavaScript transform function (e.g., return data.users.map(u => u.name))"
					disabled={!hasEditableTab}
					bind:value={customTransform}
				></textarea>
				<button class="tool-btn" disabled={!$currentTab || !customTransform.trim()} onclick={applyCustomTransform}>
					<Icon name="play" size={14} />
					Apply Transform
				</button>
			</div>
		{/if}
	</div>

	<div
		class="resize-handle"
		onmousedown={startResize}
		onkeydown={(e) => {
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				sidebarWidth = Math.max(200, sidebarWidth - 10);
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				sidebarWidth = Math.min(400, sidebarWidth + 10);
			}
		}}
		role="slider"
		aria-label="Resize sidebar"
		aria-valuenow={sidebarWidth}
		aria-valuemin={200}
		aria-valuemax={400}
		aria-orientation="horizontal"
		title="Drag to resize sidebar or use arrow keys"
		tabindex="0"
	></div>
</div>

<style>
	.sidebar {
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		min-width: 200px;
		max-width: 400px;
		position: relative;
		color: var(--color-text);
		transition: width 0.3s ease;
	}

	.sidebar.collapsed {
		min-width: 48px;
		max-width: 48px;
	}

	.sidebar-header {
		padding: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-secondary);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.collapse-btn {
		padding: var(--spacing-xs);
		background: transparent;
		border: 1px solid var(--color-border-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
		border-radius: var(--border-radius-sm);
		transition: all 0.2s ease;
		width: fit-content;
		align-self: flex-end;
	}

	.collapse-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tab-buttons {
		display: flex;
		gap: var(--spacing-xs);
	}

	.tab-btn {
		padding: calc(var(--spacing-xs) * 1.5) var(--spacing-sm);
		background: transparent;
		border: 1px solid var(--color-border-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: var(--font-size-xs);
		border-radius: var(--border-radius-sm);
		transition: all 0.2s ease;
		font-family: var(--font-sans);
		flex: 1;
	}

	.tab-btn.active {
		background: var(--color-primary);
		color: var(--color-text-inverted);
		border-color: var(--color-primary);
	}

	.tab-btn:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tab-btn.active:hover {
		background: var(--color-primary-hover);
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-md);
	}

	.collapsed-tools {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		align-items: center;
	}

	.collapsed-tool-btn {
		width: 32px;
		height: 32px;
		padding: var(--spacing-xs);
		background: var(--color-background-secondary);
		border: 1px solid var(--color-border-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
		border-radius: var(--border-radius-sm);
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.collapsed-tool-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.collapsed-tool-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.panel h3 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: var(--font-size-sm);
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border-secondary);
		padding-bottom: var(--spacing-xs);
		font-family: var(--font-sans);
		font-weight: 600;
	}

	.tool-group {
		margin-bottom: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.tool-btn {
		padding: var(--spacing-sm);
		background: var(--color-background-secondary);
		border: 1px solid var(--color-border-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		font-size: var(--font-size-sm);
		border-radius: var(--border-radius-sm);
		transition: all 0.2s ease;
		font-family: var(--font-sans);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		width: 100%;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.tool-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tool-btn :global(svg) {
		flex-shrink: 0;
		opacity: 0.8;
	}

	.tool-btn:hover:not(:disabled) :global(svg) {
		opacity: 1;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-sm);
	}

	.stat-item {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.stat-item .stat-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		font-family: var(--font-sans);
		font-weight: 500;
	}

	.stat-item span {
		font-size: var(--font-size-sm);
		color: var(--color-text);
		font-weight: 600;
		font-family: var(--font-mono);
	}

	.no-data {
		color: var(--color-text-muted);
		font-style: italic;
		text-align: center;
		margin-top: var(--spacing-lg);
		font-family: var(--font-sans);
	}

	.transform-input {
		width: 100%;
		min-height: 100px;
		background: var(--color-editor-background);
		border: 1px solid var(--color-border-secondary);
		color: var(--color-editor-foreground);
		padding: var(--spacing-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		resize: vertical;
		margin-bottom: var(--spacing-sm);
		border-radius: var(--border-radius-sm);
		transition: border-color 0.2s ease;
	}

	.transform-input:focus {
		outline: none;
		border-color: var(--color-border-focus);
		box-shadow: 0 0 0 2px rgba(var(--color-primary), 0.2);
	}

	.transform-input::placeholder {
		color: var(--color-text-muted);
	}

	.resize-handle {
		position: absolute;
		top: 0;
		right: 0;
		width: 4px;
		height: 100%;
		cursor: col-resize;
		background: transparent;
		border: none;
		padding: 0;
		transition: background-color 0.2s ease;
	}

	.resize-handle:hover {
		background: var(--color-primary);
	}

	/* Theme-aware scrollbar */
	.sidebar-content::-webkit-scrollbar {
		width: 6px;
	}

	.sidebar-content::-webkit-scrollbar-track {
		background: var(--color-background-secondary);
	}

	.sidebar-content::-webkit-scrollbar-thumb {
		background: var(--color-border-secondary);
		border-radius: var(--border-radius-sm);
	}

	.sidebar-content::-webkit-scrollbar-thumb:hover {
		background: var(--color-border);
	}

	@media (max-width: 768px) {
		.sidebar {
			min-width: 180px;
		}
		
		.sidebar-content {
			padding: var(--spacing-sm);
		}
		
		.stats-grid {
			grid-template-columns: 1fr;
			gap: var(--spacing-sm);
		}
		
		.tool-btn {
			font-size: var(--font-size-xs);
			padding: var(--spacing-xs) var(--spacing-sm);
		}

		.tool-btn :global(svg) {
			width: 12px;
			height: 12px;
		}
	}

	/* High contrast mode support */
	@media (prefers-contrast: high) {
		.tool-btn {
			border-width: 2px;
		}
		
		.transform-input:focus {
			border-width: 2px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none !important;
		}
	}
</style>