<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { tabs, type CompareData } from '$lib/stores/tabs';
	import { fileOperations } from '$lib/services/file';
	import { diffService, type DiffLineInfo, type DiffStats } from '$lib/services/diff';
	import Select from '../ui/Select.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		tabId: string;
		compareData: CompareData;
	}

	let { tabId, compareData }: Props = $props();

	// Ace editor instances
	let leftEditorRef: HTMLElement | null = $state(null);
	let rightEditorRef: HTMLElement | null = $state(null);
	let unifiedEditorRef: HTMLElement | null = $state(null);
	let leftEditor: any = null;
	let rightEditor: any = null;
	let unifiedEditor: any = null;
	let ace: any = null;

	// Local state
	let leftContent = $state('');
	let rightContent = $state('');
	let leftTitle = $state('Left File');
	let rightTitle = $state('Right File');

	// Flag to prevent update loops
	let isUpdatingEditors = false;
	// Flag to prevent scroll sync loops
	let isSyncingScroll = false;

	// Sync from prop on mount/prop change
	$effect(() => {
		if (compareData) {
			const newLeftContent = compareData.leftContent || '';
			const newRightContent = compareData.rightContent || '';
			const newLeftTitle = compareData.leftTitle || 'Left File';
			const newRightTitle = compareData.rightTitle || 'Right File';

			// Only update if values actually changed
			untrack(() => {
				if (leftContent !== newLeftContent) leftContent = newLeftContent;
				if (rightContent !== newRightContent) rightContent = newRightContent;
				if (leftTitle !== newLeftTitle) leftTitle = newLeftTitle;
				if (rightTitle !== newRightTitle) rightTitle = newRightTitle;
			});
		}
	});

	// View state
	let diffMode: 'side-by-side' | 'unified' = $state('side-by-side');
	let leftSource: 'tab' | 'file' = $state('tab');
	let rightSource: 'tab' | 'file' = $state('file');
	let selectedLeftTab = $state('');
	let selectedRightTab = $state('');
	let isReady = $state(false);

	// Diff state
	let diffStats: DiffStats = $state({ added: 0, removed: 0, modified: 0 });
	let leftDiffLines: DiffLineInfo[] = $state([]);
	let rightDiffLines: DiffLineInfo[] = $state([]);
	let unifiedContent = $state('');
	let unifiedDiffLines: DiffLineInfo[] = $state([]);

	// Get available tabs (excluding compare tabs)
	const availableTabs = $derived($tabs.filter((tab) => tab.type !== 'compare' && tab.content.trim() !== ''));

	// Sync changes back to tab store
	function syncToStore() {
		tabs.updateCompareData(tabId, {
			leftContent,
			leftTitle,
			rightContent,
			rightTitle
		});
	}

	// Update editors and calculate diff when content changes
	$effect(() => {
		const left = leftContent;
		const right = rightContent;

		if (isUpdatingEditors) return;

		// Update editors if ready
		if (leftEditor && left !== undefined) {
			const formattedLeft = diffService.formatJSON(left);
			const currentValue = leftEditor.getValue();
			if (currentValue !== formattedLeft) {
				isUpdatingEditors = true;
				leftEditor.setValue(formattedLeft, -1);
				isUpdatingEditors = false;
			}
		}

		if (rightEditor && right !== undefined) {
			const formattedRight = diffService.formatJSON(right);
			const currentValue = rightEditor.getValue();
			if (currentValue !== formattedRight) {
				isUpdatingEditors = true;
				rightEditor.setValue(formattedRight, -1);
				isUpdatingEditors = false;
			}
		}

		// Calculate differences
		if (left && right) {
			untrack(() => {
				calculateDifferences();
			});
		}
	});

	// Initialize editors when refs become available
	$effect(() => {
		// Track the refs
		const leftRef = leftEditorRef;
		const rightRef = rightEditorRef;
		const left = leftContent;
		const right = rightContent;
		const mode = diffMode;

		// Only initialize when we have refs and content
		if (mode === 'side-by-side' && leftRef && rightRef && left && right && !leftEditor && !rightEditor) {
			initializeEditors();
		}
	});

	// Initialize unified editor when mode changes
	$effect(() => {
		const unifiedRef = unifiedEditorRef;
		const mode = diffMode;
		const content = unifiedContent;

		if (mode === 'unified' && unifiedRef && content && !unifiedEditor) {
			initializeUnifiedEditor();
		}
	});

	// Update unified editor content when it changes
	$effect(() => {
		if (unifiedEditor && unifiedContent) {
			const currentValue = unifiedEditor.getValue();
			if (currentValue !== unifiedContent) {
				isUpdatingEditors = true;
				unifiedEditor.setValue(unifiedContent, -1);
				isUpdatingEditors = false;

				tick().then(() => {
					applyUnifiedHighlighting();
				});
			}
		}
	});

	// Apply diff highlighting after editors are ready
	$effect(() => {
		if (isReady && leftEditor && rightEditor && diffMode === 'side-by-side') {
			// Read diffStats to track changes
			const currentStats = diffStats;
			if (currentStats) {
				tick().then(() => {
					applyDiffHighlighting();
				});
			}
		}
	});

	async function selectLeftFile() {
		try {
			const result = await fileOperations.openFile();
			if (result) {
				leftContent = result.content;
				leftTitle = result.name;
				syncToStore();
			}
		} catch (error) {
			console.error('Error selecting left file:', error);
		}
	}

	async function selectRightFile() {
		try {
			const result = await fileOperations.openFile();
			if (result) {
				rightContent = result.content;
				rightTitle = result.name;
				syncToStore();
			}
		} catch (error) {
			console.error('Error selecting right file:', error);
		}
	}

	function selectLeftTab() {
		const tab = $tabs.find((t) => t.id === selectedLeftTab);
		if (tab) {
			leftContent = tab.content;
			leftTitle = tab.title;
			syncToStore();
		}
	}

	function selectRightTab() {
		const tab = $tabs.find((t) => t.id === selectedRightTab);
		if (tab) {
			rightContent = tab.content;
			rightTitle = tab.title;
			syncToStore();
		}
	}

	function calculateDifferences() {
		// Use the diff service to calculate differences
		const result = diffService.calculateDiff(leftContent, rightContent);
		diffStats = result.stats;
		leftDiffLines = result.leftLines;
		rightDiffLines = result.rightLines;

		// Generate unified diff content
		const unifiedResult = diffService.generateUnifiedDiff(leftContent, rightContent, leftDiffLines, rightDiffLines);
		unifiedContent = unifiedResult.content;
		unifiedDiffLines = unifiedResult.lines;
	}

	function applyDiffHighlighting() {
		if (!leftEditor || !rightEditor || !ace) return;

		const Range = ace.require('ace/range').Range;

		// Clear previous markers
		clearEditorMarkers(leftEditor);
		clearEditorMarkers(rightEditor);

		const leftSession = leftEditor.getSession();
		const rightSession = rightEditor.getSession();

		// Apply left side markers (removed and modified)
		for (const diffLine of leftDiffLines) {
			const lineContent = leftSession.getLine(diffLine.line) || '';
			const markerClass =
				diffLine.type === 'removed'
					? 'diff-line-removed'
					: diffLine.type === 'modified'
						? 'diff-line-modified'
						: '';

			if (markerClass) {
				// Full line background
				leftSession.addMarker(new Range(diffLine.line, 0, diffLine.line, 1), markerClass, 'fullLine', false);

				// Gutter decoration
				leftSession.addGutterDecoration(diffLine.line, diffLine.type === 'removed' ? 'diff-gutter-removed' : 'diff-gutter-modified');

				// Character-level highlighting for modifications
				if (diffLine.type === 'modified' && diffLine.charChanges) {
					// Find the value portion of the line
					const colonIdx = lineContent.indexOf(':');
					if (colonIdx > -1) {
						leftSession.addMarker(
							new Range(diffLine.line, colonIdx + 2, diffLine.line, lineContent.length),
							'diff-char-removed',
							'text',
							false
						);
					}
				}
			}
		}

		// Apply right side markers (added and modified)
		for (const diffLine of rightDiffLines) {
			const lineContent = rightSession.getLine(diffLine.line) || '';
			const markerClass =
				diffLine.type === 'added'
					? 'diff-line-added'
					: diffLine.type === 'modified'
						? 'diff-line-modified'
						: '';

			if (markerClass) {
				// Full line background
				rightSession.addMarker(new Range(diffLine.line, 0, diffLine.line, 1), markerClass, 'fullLine', false);

				// Gutter decoration
				rightSession.addGutterDecoration(diffLine.line, diffLine.type === 'added' ? 'diff-gutter-added' : 'diff-gutter-modified');

				// Character-level highlighting for modifications
				if (diffLine.type === 'modified' && diffLine.charChanges) {
					// Find the value portion of the line
					const colonIdx = lineContent.indexOf(':');
					if (colonIdx > -1) {
						rightSession.addMarker(
							new Range(diffLine.line, colonIdx + 2, diffLine.line, lineContent.length),
							'diff-char-added',
							'text',
							false
						);
					}
				}
			}
		}
	}

	function applyUnifiedHighlighting() {
		if (!unifiedEditor || !ace) return;

		const Range = ace.require('ace/range').Range;

		// Clear previous markers
		clearEditorMarkers(unifiedEditor);

		const session = unifiedEditor.getSession();

		for (const diffLine of unifiedDiffLines) {
			if (diffLine.type === 'context') continue;

			const lineContent = session.getLine(diffLine.line) || '';
			const markerClass = diffLine.type === 'added' ? 'diff-line-added' : 'diff-line-removed';
			const gutterClass = diffLine.type === 'added' ? 'diff-gutter-added' : 'diff-gutter-removed';

			// Full line background
			session.addMarker(new Range(diffLine.line, 0, diffLine.line, 1), markerClass, 'fullLine', false);

			// Gutter decoration
			session.addGutterDecoration(diffLine.line, gutterClass);

			// Highlight the actual content (skip the +/- prefix)
			if (lineContent.length > 2) {
				const charClass = diffLine.type === 'added' ? 'diff-char-added' : 'diff-char-removed';
				session.addMarker(new Range(diffLine.line, 2, diffLine.line, lineContent.length), charClass, 'text', false);
			}
		}
	}

	function clearEditorMarkers(editor: any) {
		const session = editor.getSession();

		// Remove all markers
		const markers = session.getMarkers(false);
		for (const id in markers) {
			if (markers[id].clazz?.startsWith('diff-')) {
				session.removeMarker(parseInt(id));
			}
		}

		// Clear gutter decorations
		const lineCount = session.getLength();
		for (let i = 0; i < lineCount; i++) {
			session.removeGutterDecoration(i, 'diff-gutter-added');
			session.removeGutterDecoration(i, 'diff-gutter-removed');
			session.removeGutterDecoration(i, 'diff-gutter-modified');
		}
	}

	function swapSides() {
		const tempContent = leftContent;
		const tempTitle = leftTitle;
		leftContent = rightContent;
		leftTitle = rightTitle;
		rightContent = tempContent;
		rightTitle = tempTitle;
		syncToStore();
	}

	function syncScroll(source: 'left' | 'right') {
		if (!leftEditor || !rightEditor || isSyncingScroll) return;

		isSyncingScroll = true;

		const sourceEditor = source === 'left' ? leftEditor : rightEditor;
		const targetEditor = source === 'left' ? rightEditor : leftEditor;

		const sourceSession = sourceEditor.getSession();
		const targetSession = targetEditor.getSession();

		// Get the scroll metrics for both editors
		const sourceScrollTop = sourceSession.getScrollTop();
		const sourceLineHeight = sourceEditor.renderer.lineHeight || 16;
		const sourceLineCount = sourceSession.getLength();
		const sourceMaxScroll = Math.max(0, sourceLineCount * sourceLineHeight - sourceEditor.renderer.$size.scrollerHeight);

		const targetLineHeight = targetEditor.renderer.lineHeight || 16;
		const targetLineCount = targetSession.getLength();
		const targetMaxScroll = Math.max(0, targetLineCount * targetLineHeight - targetEditor.renderer.$size.scrollerHeight);

		// Calculate scroll percentage and apply to target
		if (sourceMaxScroll > 0) {
			const scrollPercent = sourceScrollTop / sourceMaxScroll;
			const targetScrollTop = scrollPercent * targetMaxScroll;
			targetSession.setScrollTop(targetScrollTop);
		} else {
			targetSession.setScrollTop(0);
		}

		// Release the lock after a short delay to allow the scroll event to complete
		requestAnimationFrame(() => {
			isSyncingScroll = false;
		});
	}

	async function initializeEditors() {
		if (!browser || !leftEditorRef || !rightEditorRef) return;

		try {
			// Dynamic import ace
			ace = await import('ace-builds');
			await import('ace-builds/src-noconflict/mode-json');
			await import('ace-builds/src-noconflict/theme-one_dark');

			// Configure ace base path
			ace.config.set('basePath', 'https://cdn.jsdelivr.net/npm/ace-builds@1.32.2/src-noconflict/');

			// Initialize left editor
			leftEditor = ace.edit(leftEditorRef);
			leftEditor.setTheme('ace/theme/one_dark');
			leftEditor.session.setMode('ace/mode/json');
			leftEditor.setReadOnly(true);
			leftEditor.setShowPrintMargin(false);
			leftEditor.setOptions({
				fontSize: '13px',
				fontFamily: 'var(--font-mono, monospace)',
				showGutter: true,
				highlightActiveLine: false,
				wrap: false
			});

			// Set initial content
			if (leftContent) {
				leftEditor.setValue(diffService.formatJSON(leftContent), -1);
			}

			// Sync scroll
			leftEditor.getSession().on('changeScrollTop', () => {
				syncScroll('left');
			});

			// Initialize right editor
			rightEditor = ace.edit(rightEditorRef);
			rightEditor.setTheme('ace/theme/one_dark');
			rightEditor.session.setMode('ace/mode/json');
			rightEditor.setReadOnly(true);
			rightEditor.setShowPrintMargin(false);
			rightEditor.setOptions({
				fontSize: '13px',
				fontFamily: 'var(--font-mono, monospace)',
				showGutter: true,
				highlightActiveLine: false,
				wrap: false
			});

			// Set initial content
			if (rightContent) {
				rightEditor.setValue(diffService.formatJSON(rightContent), -1);
			}

			// Sync scroll
			rightEditor.getSession().on('changeScrollTop', () => {
				syncScroll('right');
			});

			isReady = true;

			// Apply initial highlighting if we have content
			if (leftContent && rightContent) {
				await tick();
				applyDiffHighlighting();
			}
		} catch (error) {
			console.error('Failed to initialize Ace editors:', error);
		}
	}

	async function initializeUnifiedEditor() {
		if (!browser || !unifiedEditorRef) return;

		try {
			if (!ace) {
				ace = await import('ace-builds');
				await import('ace-builds/src-noconflict/mode-json');
				await import('ace-builds/src-noconflict/theme-one_dark');
				ace.config.set('basePath', 'https://cdn.jsdelivr.net/npm/ace-builds@1.32.2/src-noconflict/');
			}

			unifiedEditor = ace.edit(unifiedEditorRef);
			unifiedEditor.setTheme('ace/theme/one_dark');
			unifiedEditor.session.setMode('ace/mode/text');
			unifiedEditor.setReadOnly(true);
			unifiedEditor.setShowPrintMargin(false);
			unifiedEditor.setOptions({
				fontSize: '13px',
				fontFamily: 'var(--font-mono, monospace)',
				showGutter: true,
				highlightActiveLine: false,
				wrap: false
			});

			if (unifiedContent) {
				unifiedEditor.setValue(unifiedContent, -1);
				await tick();
				applyUnifiedHighlighting();
			}
		} catch (error) {
			console.error('Failed to initialize unified editor:', error);
		}
	}

	// Cleanup unified editor when switching modes
	$effect(() => {
		const mode = diffMode;
		if (mode === 'side-by-side' && unifiedEditor) {
			unifiedEditor.destroy();
			unifiedEditor = null;
		}
	});

	onDestroy(() => {
		if (leftEditor) {
			leftEditor.destroy();
			leftEditor = null;
		}
		if (rightEditor) {
			rightEditor.destroy();
			rightEditor = null;
		}
		if (unifiedEditor) {
			unifiedEditor.destroy();
			unifiedEditor = null;
		}
	});
</script>

<div class="compare-view">
	<!-- Toolbar -->
	<div class="compare-toolbar">
		<div class="toolbar-left">
			<div class="toolbar-title">
				<Icon name="compare" size={16} />
				<span>Compare Files</span>
			</div>
			<div class="diff-stats">
				<span class="stat added">
					<Icon name="plus" size={12} />
					{diffStats.added} added
				</span>
				<span class="stat removed">
					<Icon name="close" size={12} />
					{diffStats.removed} removed
				</span>
				<span class="stat modified">
					<Icon name="edit" size={12} />
					{diffStats.modified} modified
				</span>
			</div>
		</div>
		<div class="toolbar-right">
			<div class="control-group">
				<Select
					bind:value={diffMode}
					options={[
						{ value: 'side-by-side', label: 'Side by Side' },
						{ value: 'unified', label: 'Unified' }
					]}
				/>
			</div>
			<button class="toolbar-btn" onclick={swapSides} title="Swap sides">
				<Icon name="refresh" size={14} />
				<span>Swap</span>
			</button>
		</div>
	</div>

	<!-- File Selectors -->
	<div class="file-selectors">
		<div class="file-selector left-selector">
			<div class="selector-header">
				<span class="selector-label">Left</span>
				<span class="file-title" title={leftTitle}>{leftTitle}</span>
			</div>
			<div class="selector-controls">
				<Select
					bind:value={leftSource}
					options={[
						{ value: 'tab', label: 'Tab' },
						{ value: 'file', label: 'File' }
					]}
				/>
				{#if leftSource === 'tab'}
					<Select
						bind:value={selectedLeftTab}
						onchange={selectLeftTab}
						options={[{ value: '', label: 'Select...' }, ...availableTabs.map((tab) => ({ value: tab.id, label: tab.title }))]}
					/>
				{:else}
					<button class="browse-btn" onclick={selectLeftFile}>
						<Icon name="folder" size={14} />
						Browse
					</button>
				{/if}
			</div>
		</div>

		<div class="selector-divider">
			<Icon name="compare" size={16} />
		</div>

		<div class="file-selector right-selector">
			<div class="selector-header">
				<span class="selector-label">Right</span>
				<span class="file-title" title={rightTitle}>{rightTitle}</span>
			</div>
			<div class="selector-controls">
				<Select
					bind:value={rightSource}
					options={[
						{ value: 'tab', label: 'Tab' },
						{ value: 'file', label: 'File' }
					]}
				/>
				{#if rightSource === 'tab'}
					<Select
						bind:value={selectedRightTab}
						onchange={selectRightTab}
						options={[{ value: '', label: 'Select...' }, ...availableTabs.map((tab) => ({ value: tab.id, label: tab.title }))]}
					/>
				{:else}
					<button class="browse-btn" onclick={selectRightFile}>
						<Icon name="folder" size={14} />
						Browse
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Diff Content -->
	<div class="diff-content">
		{#if !leftContent || !rightContent}
			<div class="empty-state">
				<Icon name="compare" size={48} />
				<h3>Select files to compare</h3>
				<p>Choose files from open tabs or browse from your system</p>
			</div>
		{:else if diffMode === 'side-by-side'}
			<div class="side-by-side">
				<div class="diff-panel left-panel">
					<div class="panel-header">
						<span class="panel-title">{leftTitle}</span>
						<span class="panel-badge removed">Original</span>
					</div>
					<div class="panel-content">
						<div class="ace-editor-container" bind:this={leftEditorRef}></div>
					</div>
				</div>

				<div class="diff-panel right-panel">
					<div class="panel-header">
						<span class="panel-title">{rightTitle}</span>
						<span class="panel-badge added">Modified</span>
					</div>
					<div class="panel-content">
						<div class="ace-editor-container" bind:this={rightEditorRef}></div>
					</div>
				</div>
			</div>
		{:else}
			<div class="unified-view">
				<div class="unified-header">
					<div class="unified-header-left">
						<Icon name="file" size={14} />
						<span class="unified-file-name">{leftTitle}</span>
						<Icon name="arrow-right" size={12} />
						<span class="unified-file-name">{rightTitle}</span>
					</div>
					<div class="unified-header-right">
						<span class="unified-stat">
							<span class="stat-added">+{diffStats.added}</span>
							<span class="stat-removed">-{diffStats.removed}</span>
						</span>
					</div>
				</div>
				<div class="unified-editor-container">
					<div class="ace-editor-container" bind:this={unifiedEditorRef}></div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.compare-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface);
		overflow: hidden;
	}

	.compare-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		gap: 16px;
		flex-shrink: 0;
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.toolbar-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: var(--color-text);
	}

	.diff-stats {
		display: flex;
		gap: 12px;
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		padding: 2px 8px;
		border-radius: 10px;
		background: var(--color-surface);
	}

	.stat.added {
		color: var(--color-success);
	}
	.stat.removed {
		color: var(--color-error);
	}
	.stat.modified {
		color: var(--color-warning);
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.control-group {
		display: flex;
		gap: 4px;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.toolbar-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.file-selectors {
		display: flex;
		align-items: stretch;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.file-selector {
		flex: 1;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.left-selector {
		border-right: 1px solid var(--color-border);
	}

	.selector-divider {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		color: var(--color-text-muted);
		background: var(--color-surface);
	}

	.selector-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.selector-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.file-title {
		font-size: 13px;
		color: var(--color-primary);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selector-controls {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.browse-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.browse-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.diff-content {
		flex: 1;
		overflow: hidden;
		display: flex;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
	}

	.empty-state h3 {
		margin: 0;
		color: var(--color-text-secondary);
	}

	.empty-state p {
		margin: 0;
		font-size: 13px;
	}

	.side-by-side {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.diff-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.left-panel {
		border-right: 1px solid var(--color-border);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.panel-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 3px;
		text-transform: uppercase;
	}

	.panel-badge.removed {
		background: rgba(220, 53, 69, 0.2);
		color: var(--color-error);
	}

	.panel-badge.added {
		background: rgba(40, 167, 69, 0.2);
		color: var(--color-success);
	}

	.panel-content {
		flex: 1;
		overflow: hidden;
		background: var(--color-background);
	}

	.ace-editor-container {
		width: 100%;
		height: 100%;
	}

	.unified-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.unified-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.unified-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.unified-file-name {
		color: var(--color-text);
		font-weight: 500;
	}

	.unified-header-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.unified-stat {
		display: flex;
		gap: 8px;
		font-size: 12px;
		font-weight: 600;
		font-family: var(--font-mono);
	}

	.stat-added {
		color: var(--color-success);
	}

	.stat-removed {
		color: var(--color-error);
	}

	.unified-editor-container {
		flex: 1;
		overflow: hidden;
		background: var(--color-background);
	}

	:global(.diff-line-added) {
		background: rgba(40, 167, 69, 0.15) !important;
		position: absolute;
		left: 0;
		right: 0;
	}

	:global(.diff-line-removed) {
		background: rgba(220, 53, 69, 0.15) !important;
		position: absolute;
		left: 0;
		right: 0;
	}

	:global(.diff-line-modified) {
		background: rgba(255, 193, 7, 0.1) !important;
		position: absolute;
		left: 0;
		right: 0;
	}

	:global(.diff-char-added) {
		background: rgba(40, 167, 69, 0.35) !important;
		border-radius: 2px;
	}

	:global(.diff-char-removed) {
		background: rgba(220, 53, 69, 0.35) !important;
		border-radius: 2px;
	}

	:global(.diff-gutter-added) {
		background: var(--color-success) !important;
	}

	:global(.diff-gutter-removed) {
		background: var(--color-error) !important;
	}

	:global(.diff-gutter-modified) {
		background: var(--color-warning) !important;
	}

	:global(.ace_gutter-cell.diff-gutter-added),
	:global(.ace_gutter-cell.diff-gutter-removed),
	:global(.ace_gutter-cell.diff-gutter-modified) {
		border-left: 3px solid;
		padding-left: 5px;
	}

	:global(.ace_gutter-cell.diff-gutter-added) {
		border-left-color: var(--color-success);
	}

	:global(.ace_gutter-cell.diff-gutter-removed) {
		border-left-color: var(--color-error);
	}

	:global(.ace_gutter-cell.diff-gutter-modified) {
		border-left-color: var(--color-warning);
	}

	:global(.ace-one_dark) {
		background-color: var(--color-background) !important;
	}

	:global(.ace-one_dark .ace_gutter) {
		background: var(--color-surface-secondary) !important;
		color: var(--color-text-muted) !important;
	}

	:global(.ace-one_dark .ace_gutter-active-line) {
		background-color: transparent !important;
	}
</style>
