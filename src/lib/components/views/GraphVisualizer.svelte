<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	import {
		type JsonNode,
		type LayoutMode,
		type ViewBox,
		type Point,
		type ExportFormat,
		DEFAULT_VIEWBOX,
		ZOOM_LIMITS,
		NODE_DIMENSIONS,
		generateNodes,
		positionNodes,
		getConnectionPath,
		getNodeRows,
		formatDisplayValue,
		generateJsonPath,
		truncateValue,
		calculateCenteredViewBox,
		applyZoom,
		applyPan,
		downloadAsImage,
	} from '../../services/graph';
	import { copyToClipboard } from '../../utils/clipboard';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
	}

	let { visible = $bindable(false), content = '', onclose }: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let parsedData: unknown = $state(null);
	let nodes: JsonNode[] = $state([]);
	let viewMode: LayoutMode = $state('horizontal');
	let selectedNode: JsonNode | null = $state(null);

	// Pan and zoom state
	let viewBox: ViewBox = $state({ ...DEFAULT_VIEWBOX });
	let scale = $state(1);
	let isPanning = $state(false);
	let panStart: Point = $state({ x: 0, y: 0 });

	// Element references
	let containerRef: HTMLDivElement | undefined = $state();
	let svgRef: SVGSVGElement | undefined = $state();

	// UI state
	let connectionKey = $state(0);
	let isDownloading = $state(false);
	let exportFormat: ExportFormat = $state('svg');
	let showExportMenu = $state(false);
	let lastContent = '';

	// ============================================================================
	// Computed Values
	// ============================================================================

	const selectedNodeValue = $derived.by(() => {
		const node = selectedNode;
		if (!node) return null;
		return truncateValue(node.value, 120);
	});

	// ============================================================================
	// Content Parsing
	// ============================================================================

	function parseAndGenerateGraph(): void {
		try {
			parsedData = JSON.parse(content);
			const generatedNodes = generateNodes(parsedData);
			positionNodes(generatedNodes, viewMode);
			nodes = generatedNodes;
			centerView();
		} catch {
			parsedData = null;
			nodes = [];
		}
	}

	// ============================================================================
	// View Controls
	// ============================================================================

	function centerView(): void {
		if (nodes.length === 0) return;
		viewBox = calculateCenteredViewBox(nodes[0]);
		scale = 1;
	}

	function resetView(): void {
		scale = 1;
		viewBox = { ...DEFAULT_VIEWBOX };
		if (nodes.length > 0) {
			centerView();
		}
	}

	function switchLayout(layout: LayoutMode): void {
		viewMode = layout;
		if (nodes.length > 0) {
			positionNodes(nodes, viewMode);
			nodes = [...nodes]; // Trigger reactivity
			connectionKey++;
			centerView();
		}
	}

	// ============================================================================
	// Mouse Interaction
	// ============================================================================

	function handleMouseDown(event: MouseEvent): void {
		const target = event.target as Element;
		if (target.closest('.node')) return;

		isPanning = true;
		panStart = { x: event.clientX, y: event.clientY };
		if (svgRef) svgRef.style.cursor = 'grabbing';
		event.preventDefault();
		event.stopPropagation();
	}

	function handleMouseMove(event: MouseEvent): void {
		if (!isPanning || !svgRef) return;

		const delta: Point = {
			x: event.clientX - panStart.x,
			y: event.clientY - panStart.y,
		};

		viewBox = applyPan(viewBox, delta, scale);
		panStart = { x: event.clientX, y: event.clientY };
		event.preventDefault();
	}

	function handleMouseUp(): void {
		if (isPanning) {
			isPanning = false;
			if (svgRef) svgRef.style.cursor = 'grab';
		}
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		if (!svgRef) return;

		const rect = svgRef.getBoundingClientRect();
		const mousePosition: Point = {
			x: ((event.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x,
			y: ((event.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y,
		};

		const zoomFactor = event.deltaY < 0 ? ZOOM_LIMITS.STEP : 1 / ZOOM_LIMITS.STEP;
		const result = applyZoom(viewBox, scale, mousePosition, zoomFactor);
		viewBox = result.viewBox;
		scale = result.scale;
	}

	// ============================================================================
	// Node Interaction
	// ============================================================================

	function handleNodeClick(node: JsonNode): void {
		selectedNode = node;
	}

	function closeNodeInspector(): void {
		selectedNode = null;
	}

	// ============================================================================
	// Export
	// ============================================================================

	async function handleDownload(format: ExportFormat): Promise<void> {
		if (isDownloading) return;

		if (!svgRef) {
			console.error('SVG reference not available');
			alert('Graph not ready. Please wait and try again.');
			return;
		}

		isDownloading = true;
		showExportMenu = false;

		try {
			// Pass nodes to calculate the full graph bounds for export
			await downloadAsImage(svgRef, nodes, 'graph-visualizer', format);
		} catch (error) {
			console.error('Failed to download image:', error);
			const message = error instanceof Error ? error.message : 'Unknown error';
			alert(`Failed to download image: ${message}`);
		} finally {
			isDownloading = false;
		}
	}

	// ============================================================================
	// Clipboard
	// ============================================================================

	async function handleCopyPath(): Promise<void> {
		if (selectedNode) {
			await copyToClipboard(selectedNode.path || 'root');
		}
	}

	async function handleCopyJsonPath(): Promise<void> {
		if (selectedNode) {
			await copyToClipboard(generateJsonPath(selectedNode));
		}
	}

	async function handleCopyValue(): Promise<void> {
		if (selectedNodeValue) {
			await copyToClipboard(selectedNodeValue.full);
		}
	}

	// ============================================================================
	// Modal Controls
	// ============================================================================

	function close(): void {
		onclose?.();
	}

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		if (content && content !== lastContent) {
			lastContent = content;
			parseAndGenerateGraph();
		}
	});

	// ============================================================================
	// Helpers for Template
	// ============================================================================

	function isNodeHighlighted(nodeId: string, childId: string): boolean {
		return selectedNode !== null && 
			(selectedNode.id === nodeId || selectedNode.id === childId);
	}

	function truncateLabel(label: string): string {
		return label.length > NODE_DIMENSIONS.MAX_LABEL_LENGTH 
			? `${label.substring(0, NODE_DIMENSIONS.MAX_LABEL_LENGTH)}...` 
			: label;
	}

	function truncateRowValue(value: string): string {
		return value.length > 15 ? `${value.substring(0, 15)}...` : value;
	}

	// Get CSS variable for type color (theme-aware)
	function getTypeColorVar(value: unknown): string {
		if (value === null) return 'var(--graph-type-null)';
		if (Array.isArray(value)) return 'var(--graph-array-indicator)';
		if (typeof value === 'object' && value !== null) return 'var(--graph-type-object)';
		if (typeof value === 'string') return 'var(--graph-type-string)';
		if (typeof value === 'number') return 'var(--graph-type-number)';
		if (typeof value === 'boolean') return 'var(--graph-type-boolean)';
		return 'var(--graph-type-object)';
	}
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

{#if visible}
	<div
		class="modal-overlay"
		onclick={(e) => e.target === e.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-modal="true"
		aria-label="Graph Visualizer"
		tabindex="-1"
	>
		<section class="visualizer-modal" aria-label="Graph Visualizer Dialog">
			<!-- Header -->
			<div class="modal-header">
				<div class="header-title">
					<div class="icon-wrapper">
						<Icon name="share-2" size={24} />
					</div>
					<div>
						<h2>Graph Visualizer</h2>
						<p class="subtitle">Visualize JSON structure as a graph</p>
					</div>
				</div>
				<div class="header-controls">
					<!-- Layout Controls -->
					<div class="control-group">
						<button
							class="control-btn"
							class:active={viewMode === 'horizontal'}
							onclick={() => switchLayout('horizontal')}
							title="Horizontal Layout"
						>
							<Icon name="layout-horizontal" size={16} />
						</button>
						<button
							class="control-btn"
							class:active={viewMode === 'vertical'}
							onclick={() => switchLayout('vertical')}
							title="Vertical Layout"
						>
							<Icon name="layout-vertical" size={16} />
						</button>
					</div>

					<!-- View Controls -->
					<div class="control-group">
						<button class="control-btn" onclick={resetView} title="Reset View">
							<Icon name="refresh" size={16} />
						</button>
						<button class="control-btn" onclick={centerView} title="Center View">
							<Icon name="target" size={16} />
						</button>
						<div
							class="export-dropdown"
							role="menu"
							tabindex="-1"
							onmouseenter={() => showExportMenu = true}
							onmouseleave={() => showExportMenu = false}
						>
							<button
								class="control-btn"
								class:downloading={isDownloading}
								title={isDownloading ? 'Downloading...' : 'Download as Image'}
								disabled={isDownloading}
							>
								{#if isDownloading}
									<Icon name="loader" size={16} class="spinning" />
								{:else}
									<Icon name="download" size={16} />
								{/if}
							</button>
							{#if showExportMenu}
								<div class="export-menu">
									<div class="export-menu-inner">
										<button class="export-option" onclick={() => handleDownload('svg')}>
											<Icon name="file" size={14} />
											<span>SVG</span>
											<span class="export-hint">Vector (best for zoom)</span>
										</button>
										<button class="export-option" onclick={() => handleDownload('png')}>
											<Icon name="image" size={14} />
											<span>PNG</span>
											<span class="export-hint">Raster image</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<button class="icon-btn close-btn" onclick={close} aria-label="Close modal">
						<Icon name="close" size={20} />
					</button>
				</div>
			</div>

			<!-- Graph Content -->
			<div class="visualizer-content">
				<div class="graph-container" bind:this={containerRef}>
					<button
						class="graph-canvas-btn"
						onmousedown={handleMouseDown}
						onwheel={handleWheel}
						onkeydown={(e) => {
							if (e.key === '+' || e.key === '=') { scale = Math.min(scale * 1.1, 3); }
							else if (e.key === '-') { scale = Math.max(scale / 1.1, 0.1); }
						}}
						aria-label="Interactive graph canvas. Click and drag to pan, scroll to zoom, use +/- keys to zoom."
						style="cursor: {isPanning ? 'grabbing' : 'grab'}"
						type="button"
					>
						<svg
							bind:this={svgRef}
							class="graph-svg"
							viewBox="{viewBox.x} {viewBox.y} {viewBox.width} {viewBox.height}"
							aria-hidden="true"
						>
						<!-- Background Pattern -->
						<defs>
							<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
								<path
									d="M 20 0 L 0 0 0 20"
									fill="none"
									stroke="var(--graph-grid-color, #30363d)"
									stroke-width="0.5"
									opacity="0.3"
								/>
							</pattern>
							<!-- Arrow Markers -->
							<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
								<polygon points="0 0, 10 3.5, 0 7" fill="var(--graph-connection-color, #30363d)" />
							</marker>
							<marker id="arrowhead-highlighted" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
								<polygon points="0 0, 10 3.5, 0 7" fill="var(--graph-highlight-color, #f85149)" />
							</marker>
						</defs>

						<!-- Background -->
						<rect width="100%" height="100%" fill="var(--graph-background, #0d1117)" />
						<rect width="100%" height="100%" fill="url(#grid)" />

						<!-- Connections -->
						{#key connectionKey}
							{#each nodes as node (node.id)}
								{#each node.children as childRef (childRef.id)}
									{@const child = nodes.find(n => n.id === childRef.id) || childRef}
									{@const highlighted = isNodeHighlighted(node.id, child.id)}
									<path
										d={getConnectionPath(node, child, viewMode)}
										stroke={highlighted ? 'var(--graph-highlight-color, #f85149)' : 'var(--graph-connection-color, #30363d)'}
										stroke-width={highlighted ? 3 : 2}
										fill="none"
										marker-end={highlighted ? 'url(#arrowhead-highlighted)' : 'url(#arrowhead)'}
										class:highlighted-connection={highlighted}
										class:dimmed-connection={selectedNode && !highlighted}
									/>
								{/each}
							{/each}
						{/key}

						<!-- Nodes -->
						{#each nodes as node (node.id)}
							<g
								class="node {node.type}"
								onclick={() => handleNodeClick(node)}
								onkeydown={(e) => e.key === 'Enter' && handleNodeClick(node)}
								role="button"
								tabindex="0"
								aria-label="{node.label} ({node.type})"
							>
								<!-- Node Background -->
								<rect
									x={node.x}
									y={node.y}
									width={node.width}
									height={node.height}
									rx="6"
									fill="var(--graph-node-background, #0d1117)"
									stroke="var(--graph-node-border, #30363d)"
									stroke-width="1"
									class:selected={selectedNode === node}
								/>

								<!-- Node Header Background -->
								<rect
									x={node.x}
									y={node.y}
									width={node.width}
									height="32"
									rx="6"
									fill="var(--graph-node-header, #161b22)"
								/>
								<rect
									x={node.x}
									y={node.y + 29}
									width={node.width}
									height="3"
									fill="var(--graph-node-header, #161b22)"
								/>

								<!-- Array Indicator -->
								{#if node.type === 'array'}
									<rect
										x={node.x}
										y={node.y}
										width="3"
										height={node.height}
										rx="1"
										fill="var(--graph-array-indicator, #ec4899)"
									/>
								{/if}

								<!-- Node Label -->
								<text
									x={node.x + 12}
									y={node.y + 20}
									fill="var(--graph-text-primary, #f0f6fc)"
									font-size="12"
									font-weight="600"
									font-family="system-ui"
								>
									{truncateLabel(node.label)}
								</text>

								<!-- Node Type Badge -->
								<text
									x={node.x + node.width - 12}
									y={node.y + 20}
									fill={getTypeColorVar(node.value)}
									font-size="10"
									text-anchor="end"
									font-family="system-ui"
								>
									{node.dataType}
								</text>

								<!-- Node Content -->
								{#if node.type !== 'primitive'}
									{@const rows = getNodeRows(node.value, node.type)}
									{#each rows as row, index}
										{@const rowY = node.y + 40 + index * NODE_DIMENSIONS.ROW_HEIGHT}
										
										<!-- Alternating Row Background -->
										<rect
											x={node.x + 1}
											y={rowY}
											width={node.width - 2}
											height={NODE_DIMENSIONS.ROW_HEIGHT - 1}
											fill={index % 2 === 0 ? 'transparent' : 'var(--graph-row-alt, #161b2210)'}
										/>

										<!-- Row Key -->
										<text
											x={node.x + 12}
											y={rowY + 15}
											fill={node.type === 'array' ? 'var(--graph-array-indicator, #ec4899)' : 'var(--graph-text-secondary, #7d8590)'}
											font-size="11"
											font-family="ui-monospace, monospace"
											font-weight="500"
										>
											{node.type === 'array' ? `[${row.key}]` : `${row.key}:`}
										</text>

										<!-- Row Value -->
										<text
											x={node.x + node.width - 12}
											y={rowY + 15}
											fill={getTypeColorVar(row.value)}
											font-size="11"
											text-anchor="end"
											font-family="ui-monospace, monospace"
										>
											{truncateRowValue(row.displayValue)}
										</text>
									{/each}
								{:else}
									<!-- Primitive Value -->
									<text
										x={node.x + node.width / 2}
										y={node.y + 52}
										fill={getTypeColorVar(node.value)}
										font-size="12"
										text-anchor="middle"
										font-family="ui-monospace, monospace"
									>
										{truncateRowValue(formatDisplayValue(node.value))}
									</text>
								{/if}
							</g>
						{/each}
						</svg>
					</button>

					<!-- Node Inspector Panel -->
					{#if selectedNode && selectedNodeValue}
						<aside class="node-inspector">
							<header class="inspector-header">
								<h4>Node Details</h4>
								<button class="inspector-close" onclick={closeNodeInspector} aria-label="Close inspector">
									<Icon name="x" size={16} />
								</button>
							</header>

							<div class="inspector-content">
								<dl class="detail-list">
									<div class="detail-item">
										<dt>Label</dt>
										<dd>{selectedNode.label}</dd>
									</div>
									<div class="detail-item">
										<dt>Type</dt>
										<dd>{selectedNode.type}</dd>
									</div>
									<div class="detail-item">
										<dt>Data Type</dt>
										<dd>{selectedNode.dataType}</dd>
									</div>
									<div class="detail-item">
										<dt>Level</dt>
										<dd>{selectedNode.level}</dd>
									</div>
									<div class="detail-item detail-with-copy">
										<dt>Path</dt>
										<dd class="copyable">{selectedNode.path || 'root'}</dd>
										<button class="copy-btn-small" onclick={handleCopyPath} title="Copy Path">
											<Icon name="copy" size={12} />
										</button>
									</div>
									<div class="detail-item detail-with-copy">
										<dt>JSON Path</dt>
										<dd class="copyable">{generateJsonPath(selectedNode)}</dd>
										<button class="copy-btn-small" onclick={handleCopyJsonPath} title="Copy JSON Path">
											<Icon name="copy" size={12} />
										</button>
									</div>
								</dl>

								<div class="value-section">
									<header class="value-header">
										<strong>Value</strong>
										<button class="copy-btn-small" onclick={handleCopyValue} title="Copy Full Value">
											<Icon name="copy" size={12} />
										</button>
									</header>
									<pre class="value-preview" title={selectedNodeValue.full}>{selectedNodeValue.full}</pre>
								</div>
							</div>
						</aside>
					{/if}

					<!-- Legend -->
					<div class="legend">
						<div class="legend-item">
							<span class="legend-color object"></span>
							<span>Object</span>
						</div>
						<div class="legend-item">
							<span class="legend-color array"></span>
							<span>Array</span>
						</div>
						<div class="legend-item">
							<span class="legend-color primitive"></span>
							<span>Primitive</span>
						</div>
					</div>

					<!-- Controls Overlay -->
					<div class="controls-overlay">
						<div class="zoom-info">Zoom: {Math.round(scale * 100)}%</div>
						<div class="instructions">
							<p><Icon name="move" size={12} /> Click and drag to pan</p>
							<p><Icon name="zoom-in" size={12} /> Scroll to zoom</p>
							<p><Icon name="mouse-pointer" size={12} /> Click nodes to inspect</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	</div>
{/if}

<style>
	.modal-overlay {
		/* Base colors */
		--graph-background: var(--color-background, #0d1117);
		--graph-surface: var(--color-surface, #1a202c);
		--graph-surface-secondary: var(--color-surface-secondary, #2d3748);
		--graph-border: var(--color-border, #30363d);
		--graph-text-primary: var(--color-text, #f0f6fc);
		--graph-text-secondary: var(--color-text-secondary, #7d8590);
		--graph-primary: var(--color-primary, #3182ce);

		/* Node colors */
		--graph-node-background: var(--color-surface, #161b22);
		--graph-node-header: var(--color-surface-secondary, #21262d);
		--graph-node-border: var(--color-border, #30363d);
		--graph-row-alt: rgba(255, 255, 255, 0.03);

		/* Connection colors */
		--graph-connection-color: var(--color-border, #30363d);
		--graph-highlight-color: var(--color-error, #f85149);
		--graph-grid-color: var(--color-border, #30363d);

		/* Type colors (for values) - dark theme */
		--graph-type-string: #a5d6ff;
		--graph-type-number: #79c0ff;
		--graph-type-boolean: #ffa657;
		--graph-type-null: #ff7b72;
		--graph-type-object: #8b949e;
		--graph-array-indicator: #ec4899;
	}

	:global([data-theme-type="light"]) .modal-overlay {
		/* Base colors */
		--graph-background: #e8eaed;
		--graph-text-primary: #1f2937;
		--graph-text-secondary: #4b5563;

		/* Node colors - white nodes with shadow for contrast */
		--graph-node-background: #ffffff;
		--graph-node-header: #f3f4f6;
		--graph-node-border: #d1d5db;
		--graph-row-alt: rgba(0, 0, 0, 0.04);

		/* Connection colors */
		--graph-connection-color: #9ca3af;
		--graph-grid-color: #d1d5db;

		/* Type colors (for values) - light theme with good contrast */
		--graph-type-string: #0d9488;
		--graph-type-number: #2563eb;
		--graph-type-boolean: #d97706;
		--graph-type-null: #dc2626;
		--graph-type-object: #6b7280;
		--graph-array-indicator: #db2777;
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

	.visualizer-modal {
		background: var(--graph-surface);
		border-radius: var(--border-radius-lg, 8px);
		width: 95%;
		height: 90%;
		max-width: 1600px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: var(--graph-text-primary);
		border: 1px solid var(--graph-border);
		box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
	}

	.modal-header {
		padding: var(--spacing-md, 16px) var(--spacing-lg, 24px);
		border-bottom: 1px solid var(--graph-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--graph-surface-secondary);
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-md, 16px);
	}

	.icon-wrapper {
		width: 40px;
		height: 40px;
		border-radius: var(--border-radius-md, 8px);
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
		color: var(--graph-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.2);
	}

	.header-title h2 {
		margin: 0;
		font-size: var(--font-size-lg, 18px);
		font-weight: 600;
		color: var(--graph-text-primary);
	}

	.subtitle {
		margin: 0;
		font-size: var(--font-size-sm, 14px);
		color: var(--graph-text-secondary);
	}

	.header-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-md, 16px);
	}

	.control-group {
		display: flex;
		gap: 4px;
	}

	.control-btn {
		padding: 8px;
		background: transparent;
		border: 1px solid var(--graph-border);
		color: var(--graph-text-secondary);
		cursor: pointer;
		border-radius: var(--border-radius-sm, 4px);
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.control-btn:hover {
		background: var(--graph-border);
		color: var(--graph-text-primary);
	}

	.control-btn.active {
		background: var(--graph-primary);
		color: var(--graph-text-primary);
		border-color: var(--graph-primary);
	}

	.control-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.control-btn.downloading {
		background: var(--graph-border);
		color: var(--graph-text-primary);
	}

	.export-dropdown {
		position: relative;
	}

	.export-menu {
		position: absolute;
		top: 100%;
		right: 0;
		padding-top: 8px;
		z-index: 100;
	}

	.export-menu-inner {
		background: var(--graph-surface);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-md, 8px);
		box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.3));
		min-width: 205px;
		overflow: hidden;
	}

	.export-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 10px 12px;
		background: transparent;
		border: none;
		color: var(--graph-text-primary);
		cursor: pointer;
		text-align: left;
		font-size: 13px;
		transition: background 0.15s ease;
	}

	.export-option:hover {
		background: var(--graph-surface-secondary);
	}

	.export-option:first-child {
		border-bottom: 1px solid var(--graph-border);
	}

	.export-hint {
		margin-left: auto;
		font-size: 11px;
		color: var(--graph-text-secondary);
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.icon-btn {
		background: transparent;
		border: none;
		color: var(--graph-text-secondary);
		cursor: pointer;
		padding: var(--spacing-xs, 4px);
		border-radius: var(--border-radius-sm, 4px);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.icon-btn:hover {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
		color: var(--graph-text-primary);
	}

	.visualizer-content {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.graph-container {
		width: 100%;
		height: 100%;
		position: relative;
		background: var(--graph-background);
		overflow: hidden;
	}

	.graph-canvas-btn {
		appearance: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: inherit;
		display: block;
		width: 100%;
		height: 100%;
		background: transparent;
	}

	.graph-canvas-btn:focus {
		outline: 2px solid var(--graph-primary);
		outline-offset: -2px;
	}

	.graph-svg {
		width: 100%;
		height: 100%;
		display: block;
		user-select: none;
		touch-action: none;
	}

	.node {
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.node:hover rect:first-of-type {
		stroke: var(--graph-primary) !important;
		stroke-width: 2px !important;
	}

	.node rect.selected {
		stroke: var(--graph-primary) !important;
		stroke-width: 2px !important;
		filter: drop-shadow(0 0 8px rgba(49, 130, 206, 0.4));
	}

	/* Light theme: add shadow to nodes for better separation */
	:global([data-theme-type="light"]) .node {
		filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.1));
	}

	:global([data-theme-type="light"]) .node:hover {
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15));
	}

	:global([data-theme-type="light"]) .node rect.selected {
		filter: drop-shadow(0 2px 8px rgba(37, 99, 235, 0.3));
	}

	.highlighted-connection {
		animation: pulse-connection 2s infinite;
		filter: drop-shadow(0 0 4px var(--graph-highlight-color));
	}

	.dimmed-connection {
		opacity: 0.3;
		transition: opacity 0.3s ease;
	}

	@keyframes pulse-connection {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}

	.node-inspector {
		position: absolute;
		top: 20px;
		right: 20px;
		background: var(--graph-background);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-md, 8px);
		min-width: 280px;
		max-width: 350px;
		backdrop-filter: blur(10px);
		box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
		z-index: 10;
	}

	.inspector-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm, 12px) var(--spacing-md, 16px);
		border-bottom: 1px solid var(--graph-border);
	}

	.inspector-header h4 {
		margin: 0;
		font-size: var(--font-size-sm, 14px);
		font-weight: 600;
	}

	.inspector-close {
		background: none;
		border: none;
		color: var(--graph-text-secondary);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--border-radius-sm, 4px);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.inspector-close:hover {
		background: var(--graph-border);
		color: var(--graph-text-primary);
	}

	.inspector-content {
		padding: var(--spacing-md, 16px);
	}

	.detail-list {
		margin: 0;
		padding: 0;
	}

	.detail-item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 8px;
		font-size: var(--font-size-sm, 12px);
	}

	.detail-item dt {
		color: var(--graph-text-primary);
		font-weight: 600;
		min-width: 80px;
		flex-shrink: 0;
	}

	.detail-item dd {
		margin: 0;
		color: var(--graph-text-secondary);
		word-break: break-all;
	}

	.detail-with-copy {
		display: flex;
		align-items: center;
	}

	.detail-with-copy dd {
		flex: 1;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11px;
	}

	.copy-btn-small {
		background: transparent;
		border: 1px solid var(--graph-border);
		color: var(--graph-text-secondary);
		padding: 4px;
		border-radius: var(--border-radius-sm, 4px);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		transition: all 0.2s ease;
		flex-shrink: 0;
		margin-left: 8px;
	}

	.copy-btn-small:hover {
		background: var(--graph-border);
		color: var(--graph-text-primary);
	}

	.copy-btn-small:active {
		transform: scale(0.95);
	}

	.value-section {
		margin-top: var(--spacing-md, 16px);
		padding-top: var(--spacing-md, 16px);
		border-top: 1px solid var(--graph-border);
	}

	.value-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.value-header strong {
		font-size: var(--font-size-sm, 12px);
	}

	.value-preview {
		background: var(--graph-surface-secondary);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-sm, 4px);
		padding: var(--spacing-sm, 8px);
		margin: 0;
		font-size: 11px;
		color: var(--graph-text-primary);
		max-height: 200px;
		overflow: auto;
		cursor: help;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.value-preview:hover {
		border-color: var(--graph-primary);
	}

	.legend {
		position: absolute;
		bottom: 20px;
		left: 20px;
		background: var(--graph-background);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-md, 8px);
		padding: var(--spacing-sm, 12px);
		display: flex;
		gap: var(--spacing-md, 16px);
		backdrop-filter: blur(10px);
		z-index: 10;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-size-sm, 12px);
		color: var(--graph-text-primary);
	}

	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		border: 1px solid var(--graph-border);
	}

	.legend-color.object {
		background: var(--graph-node-background);
	}

	.legend-color.array {
		background: var(--graph-node-background);
		border-left: 3px solid var(--graph-array-indicator);
	}

	.legend-color.primitive {
		background: linear-gradient(45deg, rgba(121, 192, 255, 0.1), rgba(165, 214, 255, 0.1));
		border-color: #79c0ff;
	}

	/* Light theme legend overrides */
	:global([data-theme-type="light"]) .legend-color.primitive {
		background: linear-gradient(45deg, rgba(37, 99, 235, 0.1), rgba(59, 130, 246, 0.15));
		border-color: #2563eb;
	}

	.controls-overlay {
		position: absolute;
		bottom: 20px;
		right: 20px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm, 12px);
		z-index: 10;
	}

	.zoom-info {
		background: var(--graph-background);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-sm, 6px);
		padding: 8px 12px;
		font-size: 11px;
		color: var(--graph-text-secondary);
		backdrop-filter: blur(10px);
		text-align: center;
	}

	.instructions {
		background: var(--graph-background);
		border: 1px solid var(--graph-border);
		border-radius: var(--border-radius-md, 8px);
		padding: var(--spacing-sm, 12px);
		font-size: 11px;
		color: var(--graph-text-secondary);
		backdrop-filter: blur(10px);
		text-align: right;
	}

	.instructions p {
		margin: 0 0 4px 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
	}

	.instructions p:last-child {
		margin-bottom: 0;
	}

	.value-preview::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}

	.value-preview::-webkit-scrollbar-track {
		background: var(--graph-surface-secondary);
		border-radius: 3px;
	}

	.value-preview::-webkit-scrollbar-thumb {
		background: var(--graph-border);
		border-radius: 3px;
	}

	.value-preview::-webkit-scrollbar-thumb:hover {
		background: var(--graph-text-secondary);
	}
</style>
