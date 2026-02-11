<script lang="ts">
	import Icon from '../ui/Icon.svelte';

	let { visible = $bindable(false), content = '', onclose }: {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
	} = $props();
	
	let parsedData: any = $state(null);
	let expandedNodes = $state(new Set<string>());
	let searchTerm = $state('');
	let viewMode: 'tree' | 'breadcrumb' | 'table' = $state('tree');
	let selectedPath = $state('');
	
	$effect(() => {
		if (content) {
			parseContent();
		}
	});
	
	function parseContent() {
		try {
			parsedData = JSON.parse(content);
		} catch (error) {
			parsedData = null;
		}
	}
	
	function toggleNode(path: string) {
		const newExpandedNodes = new Set(expandedNodes);
		if (newExpandedNodes.has(path)) {
			newExpandedNodes.delete(path);
		} else {
			newExpandedNodes.add(path);
		}
		expandedNodes = newExpandedNodes;
	}
	
	function isExpanded(path: string): boolean {
		return expandedNodes.has(path);
	}
	
	function renderTreeNode(value: any, key: string, path: string, level: number = 0): any {
		const isObject = typeof value === 'object' && value !== null;
		const isArray = Array.isArray(value);
		const hasChildren = isObject && Object.keys(value).length > 0;
		const expanded = isExpanded(path);
		const indent = level * 20;
		
		if (searchTerm && !path.toLowerCase().includes(searchTerm.toLowerCase()) && 
			!JSON.stringify(value).toLowerCase().includes(searchTerm.toLowerCase())) {
			return null;
		}
		
		return {
			key,
			value,
			path,
			level,
			indent,
			isObject,
			isArray,
			hasChildren,
			expanded,
			type: isArray ? 'array' : isObject ? 'object' : typeof value
		};
	}
	
	function getAllNodes(obj: any, parentPath: string = '', level: number = 0): any[] {
		const nodes: any[] = [];
		
		if (typeof obj !== 'object' || obj === null) {
			return nodes;
		}
		
		const entries = Array.isArray(obj) 
			? obj.map((item, index) => [index.toString(), item])
			: Object.entries(obj);
		
		for (const [key, value] of entries) {
			const path = parentPath ? `${parentPath}.${key}` : key;
			const node = renderTreeNode(value, key, path, level);
			
			if (node) {
				nodes.push(node);
				
				if (node.hasChildren && node.expanded) {
					nodes.push(...getAllNodes(value, path, level + 1));
				}
			}
		}
		
		return nodes;
	}
	
	function selectPath(path: string) {
		selectedPath = path;
	}
	
	function getValueAtPath(obj: any, path: string): any {
		const keys = path.split('.');
		let current = obj;
		
		for (const key of keys) {
			if (current && typeof current === 'object') {
				current = current[key];
			} else {
				return undefined;
			}
		}
		
		return current;
	}
	
	function formatValue(value: any): string {
		if (typeof value === 'string') {
			return `"${value}"`;
		} else if (typeof value === 'object' && value !== null) {
			return Array.isArray(value) ? `Array(${value.length})` : 'Object';
		}
		return String(value);
	}
	
	function getTypeIconName(type: string): string {
		switch (type) {
			case 'object': return 'folder';
			case 'array': return 'layers';
			case 'string': return 'text-view';
			case 'number': return 'hash';
			case 'boolean': return 'success';
			case 'null': return 'x';
			default: return 'help';
		}
	}
	
	function close() {
		onclose?.();
	}
	
	function expandAll() {
		const newExpandedNodes = new Set<string>();
		
		function addAllExpandablePaths(obj: any, parentPath: string = '') {
			if (typeof obj !== 'object' || obj === null) {
				return;
			}
			
			const entries = Array.isArray(obj) 
				? obj.map((item, index) => [index.toString(), item])
				: Object.entries(obj);
			
			for (const [key, value] of entries) {
				const path = parentPath ? `${parentPath}.${key}` : key;
				
				if (typeof value === 'object' && value !== null) {
					const hasChildren = Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
					if (hasChildren) {
						newExpandedNodes.add(path);
						addAllExpandablePaths(value, path);
					}
				}
			}
		}
		
		if (parsedData) {
			addAllExpandablePaths(parsedData);
		}

		expandedNodes = newExpandedNodes;
	}
	
	function collapseAll() {
		expandedNodes = new Set<string>();
	}
	
	function getAllPaths(obj: any, parentPath: string = ''): string[] {
		const paths: string[] = [];
		
		if (typeof obj !== 'object' || obj === null) {
			return paths;
		}
		
		const entries = Array.isArray(obj) 
			? obj.map((item, index) => [index.toString(), item])
			: Object.entries(obj);
		
		for (const [key, value] of entries) {
			const path = parentPath ? `${parentPath}.${key}` : key;

			if (typeof value === 'object' && value !== null) {
				const hasChildren = Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
				if (hasChildren) {
					paths.push(path);
				}
				paths.push(...getAllPaths(value, path));
			}
		}
		
		return paths;
	}
	
	function flattenToTable(obj: any, parentPath: string = ''): any[] {
		const rows: any[] = [];
		
		if (typeof obj !== 'object' || obj === null) {
			return [{
				path: parentPath || 'root',
				type: typeof obj,
				value: obj
			}];
		}
		
		const entries = Array.isArray(obj) 
			? obj.map((item, index) => [index.toString(), item])
			: Object.entries(obj);
		
		for (const [key, value] of entries) {
			const path = parentPath ? `${parentPath}.${key}` : key;
			
			if (typeof value === 'object' && value !== null) {
				rows.push({
					path,
					type: Array.isArray(value) ? 'array' : 'object',
					value: Array.isArray(value) ? `Array(${value.length})` : 'Object'
				});
				rows.push(...flattenToTable(value, path));
			} else {
				rows.push({
					path,
					type: typeof value,
					value
				});
			}
		}
		
		return rows;
	}

	let allNodes = $derived(parsedData ? getAllNodes(parsedData) : []);
	let tableData = $derived(parsedData ? flattenToTable(parsedData) : []);
	let breadcrumbPaths = $derived(selectedPath ? selectedPath.split('.') : []);
</script>

{#if visible}
	<div
		class="modal-overlay"
		onclick={(e) => e.target === e.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-modal="true"
		aria-label="JSON Visualizer"
		tabindex="-1"
	>
		<section class="visualizer-modal" aria-label="JSON Visualizer Dialog">
			<div class="modal-header">
				<div class="header-title">
					<Icon name="visualize" size={20} class="header-icon" />
					<h2>JSON Visualizer</h2>
				</div>
				<div class="header-controls">
					<div class="view-tabs">
						<button 
							class="tab-btn {viewMode === 'tree' ? 'active' : ''}"
							onclick={() => viewMode = 'tree'}
						>
							<Icon name="tree-view" size={14} />
							Tree
						</button>
						<button 
							class="tab-btn {viewMode === 'breadcrumb' ? 'active' : ''}"
							onclick={() => viewMode = 'breadcrumb'}
						>
							<Icon name="layout-horizontal" size={14} />
							Breadcrumb
						</button>
						<button 
							class="tab-btn {viewMode === 'table' ? 'active' : ''}"
							onclick={() => viewMode = 'table'}
						>
							<Icon name="table-view" size={14} />
							Table
						</button>
					</div>
					<button class="icon-btn close-btn" onclick={close} title="Close">
						<Icon name="close" size={18} />
					</button>
				</div>
			</div>
			
			<div class="modal-toolbar">
				<div class="input-wrapper">
					<Icon name="search" size={16} class="input-icon" />
					<input
						type="text"
						bind:value={searchTerm}
						placeholder="Search paths and values..."
						class="search-input"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
					/>
				</div>
				{#if viewMode === 'tree'}
					<button class="btn btn-secondary" onclick={expandAll}>
						<Icon name="expand" size={14} />
						Expand All
					</button>
					<button class="btn btn-secondary" onclick={collapseAll}>
						<Icon name="collapse" size={14} />
						Collapse All
					</button>
				{/if}
			</div>
			
			<div class="modal-content">
				{#if !parsedData}
					<div class="error">
						<Icon name="error" size={24} />
						Invalid JSON content
					</div>
				{:else if viewMode === 'tree'}
					<div class="tree-view">
						{#each allNodes as node}
							<div 
								class="tree-node" 
								style="padding-left: {node.indent}px"
								onclick={() => selectPath(node.path)}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && selectPath(node.path)}
							>
								{#if node.hasChildren}
									<button 
										class="expand-btn"
										onclick={(e) => {
											e.stopPropagation();
											toggleNode(node.path);
										}}
									>
										<Icon name={node.expanded ? 'chevron-down' : 'chevron-right'} size={12} />
									</button>
								{:else}
									<span class="expand-spacer"></span>
								{/if}
								
								<span class="node-icon">
									<Icon name={getTypeIconName(node.type)} size={14} />
								</span>
								<span class="node-key">{node.key}:</span>
								<span class="node-value {node.type}">{formatValue(node.value)}</span>
								<span class="node-path">{node.path}</span>
							</div>
						{/each}
					</div>
				{:else if viewMode === 'breadcrumb'}
					<div class="breadcrumb-view">
						<div class="breadcrumb-nav">
							{#each breadcrumbPaths as crumb, index}
								<button 
									class="breadcrumb-item"
									onclick={() => selectedPath = breadcrumbPaths.slice(0, index + 1).join('.')}
								>
									{crumb}
								</button>
								{#if index < breadcrumbPaths.length - 1}
									<span class="breadcrumb-separator">
										<Icon name="chevron-right" size={12} />
									</span>
								{/if}
							{/each}
						</div>
						
						<div class="current-value">
							{#if selectedPath}
								<h3>Value at {selectedPath}:</h3>
								<pre class="value-display">{JSON.stringify(getValueAtPath(parsedData, selectedPath), null, 2)}</pre>
							{:else}
								<div class="empty-state">
									<Icon name="tree-view" size={48} class="empty-icon" />
									<p>Click on a tree node to see its value here.</p>
								</div>
							{/if}
						</div>
					</div>
				{:else if viewMode === 'table'}
					<div class="table-view">
						<table class="data-table">
							<thead>
								<tr>
									<th>Path</th>
									<th>Type</th>
									<th>Value</th>
								</tr>
							</thead>
							<tbody>
								{#each tableData as row}
									{#if !searchTerm || row.path.toLowerCase().includes(searchTerm.toLowerCase()) || String(row.value).toLowerCase().includes(searchTerm.toLowerCase())}
										<tr>
											<td class="path-cell">
												<code>{row.path}</code>
											</td>
											<td class="type-cell">
												<span class="type-badge {row.type}">
													<Icon name={getTypeIconName(row.type)} size={12} />
													{row.type}
												</span>
											</td>
											<td class="value-cell">
												{#if typeof row.value === 'string'}
													<span class="string-value">"{row.value}"</span>
												{:else}
													<span class="other-value">{row.value}</span>
												{/if}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</section>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

	.visualizer-modal {
		background: var(--color-surface, #2d2d2d);
		border-radius: var(--border-radius-lg, 8px);
		width: 85%;
		height: 80%;
		max-width: 1000px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: var(--shadow-xl, 0 10px 30px rgba(0, 0, 0, 0.5));
		border: 1px solid var(--color-border, #444);
	}

	.modal-header {
		padding: var(--spacing-md, 16px);
		border-bottom: 1px solid var(--color-border, #444);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-surface-secondary, #333);
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm, 10px);
	}

	.header-title :global(.header-icon) {
		color: var(--color-primary, #007acc);
	}

	.modal-header h2 {
		margin: 0;
		color: var(--color-text, #fff);
		font-size: var(--font-size-lg, 18px);
		font-weight: 600;
	}

	.header-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-md, 16px);
	}

	.view-tabs {
		display: flex;
		gap: 4px;
		background: var(--color-background-secondary, #252526);
		padding: 4px;
		border-radius: var(--border-radius-md, 6px);
	}

	.tab-btn {
		padding: 6px 12px;
		background: transparent;
		border: none;
		color: var(--color-text-secondary, #ccc);
		cursor: pointer;
		font-size: var(--font-size-sm, 12px);
		border-radius: var(--border-radius-sm, 4px);
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.2s;
	}

	.tab-btn:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
		color: var(--color-text, #fff);
	}

	.tab-btn.active {
		background: var(--color-primary, #007acc);
		color: var(--color-text-inverted, white);
	}
	
	.icon-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary, #ccc);
		cursor: pointer;
		padding: 6px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.icon-btn:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
		color: var(--color-text, #fff);
	}
	
	.modal-toolbar {
		padding: var(--spacing-sm, 12px) var(--spacing-md, 16px);
		border-bottom: 1px solid var(--color-border, #444);
		display: flex;
		gap: var(--spacing-sm, 12px);
		align-items: center;
		background: var(--color-surface-secondary, #333);
	}

	.input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
	}

	.input-wrapper :global(.input-icon) {
		position: absolute;
		left: 10px;
		color: var(--color-text-muted, #888);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px 8px 36px;
		border: 1px solid var(--color-border, #555);
		border-radius: var(--border-radius-sm, 4px);
		background: var(--color-editor-background, #1e1e1e);
		color: var(--color-text, #fff);
		font-size: var(--font-size-md, 14px);
		transition: all 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-primary, #007acc);
		box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb, 0, 122, 204), 0.2);
	}

	.btn {
		padding: 8px 12px;
		border: none;
		border-radius: var(--border-radius-sm, 4px);
		cursor: pointer;
		font-size: var(--font-size-sm, 13px);
		font-weight: 500;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.btn-secondary {
		background: var(--color-surface-hover, #444);
		color: var(--color-text, white);
	}

	.btn-secondary:hover {
		background: var(--color-border, #555);
	}

	.modal-content {
		flex: 1;
		overflow: hidden;
		background: var(--color-editor-background, #1e1e1e);
	}

	.tree-view {
		height: 100%;
		overflow-y: auto;
		padding: var(--spacing-xs, 8px);
	}

	.tree-node {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px;
		cursor: pointer;
		min-height: 24px;
		font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
		font-size: var(--font-size-sm, 13px);
		border-radius: var(--border-radius-sm, 3px);
	}

	.tree-node:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
	}

	.expand-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary, #ccc);
		cursor: pointer;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: var(--border-radius-sm, 3px);
	}

	.expand-btn:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
	}

	.expand-spacer {
		width: 20px;
	}

	.node-icon {
		display: flex;
		align-items: center;
		color: var(--color-text-secondary, #ccc);
	}

	.node-key {
		color: var(--color-syntax-property, #9cdcfe);
		font-weight: 500;
	}

	.node-value {
		color: var(--color-syntax-string, #ce9178);
	}

	.node-value.string {
		color: var(--color-syntax-string, #ce9178);
	}

	.node-value.number {
		color: var(--color-syntax-number, #b5cea8);
	}

	.node-value.boolean {
		color: var(--color-syntax-keyword, #569cd6);
	}

	.node-value.object,
	.node-value.array {
		color: var(--color-syntax-function, #dcdcaa);
	}

	.node-path {
		color: var(--color-syntax-comment, #6a9955);
		font-size: 11px;
		margin-left: auto;
		opacity: 0.6;
	}
	
	.breadcrumb-view {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.breadcrumb-nav {
		padding: var(--spacing-sm, 12px) var(--spacing-md, 16px);
		border-bottom: 1px solid var(--color-border, #444);
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--color-background-secondary, #252526);
		overflow-x: auto;
	}

	.breadcrumb-item {
		background: var(--color-primary, #007acc);
		color: var(--color-text-inverted, white);
		border: none;
		padding: 4px 10px;
		border-radius: var(--border-radius-sm, 4px);
		cursor: pointer;
		font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
		font-size: var(--font-size-sm, 12px);
		white-space: nowrap;
		transition: background 0.2s;
	}

	.breadcrumb-item:hover {
		filter: brightness(0.85);
	}

	.breadcrumb-separator {
		color: var(--color-text-muted, #666);
		display: flex;
		align-items: center;
	}

	.current-value {
		flex: 1;
		padding: var(--spacing-md, 16px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.current-value h3 {
		margin: 0 0 12px 0;
		color: var(--color-text, #fff);
		font-size: var(--font-size-md, 14px);
		font-weight: 600;
	}

	.value-display {
		background: var(--color-background-secondary, #252526);
		border: 1px solid var(--color-border, #444);
		color: var(--color-text, #d4d4d4);
		padding: var(--spacing-md, 16px);
		border-radius: var(--border-radius-md, 6px);
		font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
		font-size: var(--font-size-sm, 13px);
		margin: 0;
		overflow-x: auto;
		flex: 1;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-muted, #666);
		gap: var(--spacing-md, 16px);
	}

	.empty-state :global(.empty-icon) {
		opacity: 0.5;
	}

	.table-view {
		height: 100%;
		overflow: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
		font-size: var(--font-size-sm, 12px);
	}

	.data-table th {
		background: var(--color-background-secondary, #252526);
		color: var(--color-text, #fff);
		padding: 10px 12px;
		text-align: left;
		border-bottom: 1px solid var(--color-border, #444);
		position: sticky;
		top: 0;
		font-weight: 600;
	}

	.data-table td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border-subtle, #333);
		vertical-align: top;
	}

	.data-table tr:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
	}

	.path-cell code {
		color: var(--color-syntax-property, #9cdcfe);
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
		padding: 2px 6px;
		border-radius: var(--border-radius-sm, 3px);
	}

	.type-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 11px;
		background: var(--color-surface-hover, #444);
		color: var(--color-text, #fff);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.type-badge.string { background: rgba(141, 78, 38, 0.3); border-color: rgba(141, 78, 38, 0.5); }
	.type-badge.number { background: rgba(45, 90, 61, 0.3); border-color: rgba(45, 90, 61, 0.5); }
	.type-badge.boolean { background: rgba(45, 74, 107, 0.3); border-color: rgba(45, 74, 107, 0.5); }
	.type-badge.object { background: rgba(90, 77, 45, 0.3); border-color: rgba(90, 77, 45, 0.5); }
	.type-badge.array { background: rgba(77, 45, 90, 0.3); border-color: rgba(77, 45, 90, 0.5); }

	.string-value {
		color: var(--color-syntax-string, #ce9178);
	}

	.other-value {
		color: var(--color-syntax-number, #b5cea8);
	}

	.error {
		padding: 40px;
		text-align: center;
		color: var(--color-error, #ff6b6b);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-md, 16px);
	}
</style>