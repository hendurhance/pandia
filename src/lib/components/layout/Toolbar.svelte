<script lang="ts">
	import { tabs, currentTab } from "$lib/stores/tabs";
	import { fileOperations } from "$lib/services/file";
	import { jsonUtils } from "$lib/services/json";
	import { showShortcutsModal, shortcutManager } from "$lib/stores/shortcuts";
	import { showSchemaModal, validationResult } from "$lib/stores/validation";
	import { autoSaveStatus, autoSaveManager } from "$lib/stores/autosave";
	import { historyManager } from "$lib/stores/history";
	import { FILE_LIMITS } from "$lib/constants";
	import Icon from "../ui/Icon.svelte";
	import SettingsModal from "../modals/SettingsModal.svelte";
	import HelpModal from "../modals/HelpModal.svelte";
	import Select from "../ui/Select.svelte";

	interface Props {
		onopenCompare?: () => void;
		onopenVisualizer?: () => void;
		onopenExport?: () => void;
		onopenJSONRepair?: () => void;
		onopenPathFinder?: () => void;
		onopenSnippetManager?: () => void;
		onopenBatchOperations?: () => void;
		onviewModeChange?: (event: { mode: string }) => void;
		onundo?: () => void;
		onredo?: () => void;
	}

	let {
		onopenCompare,
		onopenVisualizer,
		onopenExport,
		onopenJSONRepair,
		onopenPathFinder,
		onopenSnippetManager,
		onopenBatchOperations,
		onviewModeChange,
		onundo,
		onredo,
	}: Props = $props();
	let currentViewMode = $state("tree");
	let showSettings = $state(false);
	let showHelp = $state(false);
	let helpMode: "shortcuts" | "viewmodes" = $state("shortcuts");

	let isCompareTab = $derived($currentTab?.type === "compare");
	let hasEditableTab = $derived($currentTab && !isCompareTab);

	let isLargeFile = $derived.by(() => {
		if (isCompareTab) return false;
		const content = $currentTab?.content;
		if (!content) return false;
		const size = new Blob([content]).size;
		return size > FILE_LIMITS.LARGE_FILE_THRESHOLD;
	});

	let viewModeOptions = $derived.by(() => {
		const largeFileReason =
			"Large files can only use Tree View for performance";
		return [
			{ value: "tree", label: "Tree View" },
			{
				value: "text",
				label: "Text Editor",
				disabled: isLargeFile,
				disabledReason: largeFileReason,
			},
			{
				value: "grid",
				label: "Grid View",
				disabled: isLargeFile,
				disabledReason: largeFileReason,
			},
		];
	});

	function formatLastSaved(date: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffSec = Math.floor(diffMs / 1000);

		if (diffSec < 5) return "just now";
		if (diffSec < 60) return `${diffSec}s ago`;

		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;

		return date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	shortcutManager.registerAction("shortcuts", () => {
		openHelp("shortcuts");
	});

	shortcutManager.registerAction("save", () => {
		saveFile();
	});

	shortcutManager.registerAction("open", () => {
		openFile();
	});

	shortcutManager.registerAction("new", () => {
		newFile();
	});

	shortcutManager.registerAction("undo", () => {
		performUndo();
	});

	shortcutManager.registerAction("redo", () => {
		performRedo();
	});

	function closeAllModals() {
		showSettings = false;
		showHelp = false;
		showShortcutsModal.set(false);
		showSchemaModal.set(false);
	}

	function openHelp(tab: "shortcuts" | "viewmodes") {
		closeAllModals();
		helpMode = tab;
		showHelp = true;
	}

	function openSettings() {
		closeAllModals();
		showSettings = true;
	}

	function showFindReplace() {
		window.dispatchEvent(new CustomEvent("show-find-replace"));
	}

	function performUndo() {
		onundo?.();
	}

	function performRedo() {
		onredo?.();
	}

	function handleViewModeChange(value: string) {
		currentViewMode = value;
		onviewModeChange?.({ mode: currentViewMode });
	}

	export function updateViewMode(mode: string) {
		currentViewMode = mode;
	}

	async function newFile() {
		await tabs.add({
			title: "Untitled",
			content: "{}",
			isDirty: false,
			isNew: true,
		});
	}

	async function openFile() {
		try {
			const result = await fileOperations.openFile();
			if (result) {
				await tabs.add({
					title: result.name,
					content: result.content,
					filePath: result.path,
					isDirty: false,
					isNew: false,
				});
			}
		} catch (error) {
			console.error("Error opening file:", error);
		}
	}

	async function saveFile() {
		const tab = $currentTab;
		if (!tab) return;

		try {
			if (tab.isNew || !tab.filePath) {
				const result = await fileOperations.saveFileAs(
					tab.content,
					tab.title,
				);
				if (result) {
					tabs.markSaved(tab.id, result.path);
					tabs.updateTitle(tab.id, result.name);
				}
			} else {
				await fileOperations.saveFile(tab.filePath, tab.content);
				tabs.markSaved(tab.id);
			}
		} catch (error) {
			console.error("Error saving file:", error);
		}
	}

	async function formatJson() {
		const tab = $currentTab;
		if (!tab) return;

		try {
			const formatted = await jsonUtils.format(tab.content);
			tabs.updateContent(tab.id, formatted);
		} catch (error) {
			console.error("Error formatting JSON:", error);
		}
	}

	async function compressJson() {
		const tab = $currentTab;
		if (!tab) return;

		try {
			const compressed = await jsonUtils.compress(tab.content);
			tabs.updateContent(tab.id, compressed);
		} catch (error) {
			console.error("Error compressing JSON:", error);
		}
	}

	async function validateJson() {
		const tab = $currentTab;
		if (!tab) return;

		try {
			const isValid = await jsonUtils.validate(tab.content);
			alert(isValid ? "JSON is valid!" : "JSON is invalid!");
		} catch (error) {
			alert(`JSON validation error: ${error}`);
		}
	}

	function openCompare() {
		onopenCompare?.();
	}

	function openVisualizer() {
		onopenVisualizer?.();
	}

	function openExport() {
		onopenExport?.();
	}

	function openJSONRepair() {
		onopenJSONRepair?.();
	}

	function openPathFinder() {
		onopenPathFinder?.();
	}

	function openSnippetManager() {
		onopenSnippetManager?.();
	}

	function openBatchOperations() {
		onopenBatchOperations?.();
	}
</script>

<div class="toolbar">
	<!-- Left section: File operations and tools -->
	<div class="toolbar-section">
		<div class="toolbar-group">
			<button
				class="toolbar-btn"
				onclick={newFile}
				title="New File (Ctrl+N)"
				aria-label="Create new file"
			>
				<Icon name="file-new" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={openFile}
				title="Open File (Ctrl+O)"
				aria-label="Open file"
			>
				<Icon name="file-open" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={saveFile}
				disabled={!hasEditableTab}
				title="Save File (Ctrl+S)"
				aria-label="Save file"
			>
				<Icon name="file-save" size={16} />
			</button>
		</div>

		<div class="toolbar-separator"></div>

		<div class="toolbar-group">
			<button
				class="toolbar-btn"
				onclick={performUndo}
				disabled={!hasEditableTab ||
					!historyManager.canUndo($currentTab?.id || "")}
				title="Undo (Ctrl+Z)"
				aria-label="Undo last action"
			>
				<Icon name="undo" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={performRedo}
				disabled={!hasEditableTab ||
					!historyManager.canRedo($currentTab?.id || "")}
				title="Redo (Ctrl+Y)"
				aria-label="Redo last action"
			>
				<Icon name="redo" size={16} />
			</button>
		</div>

		<div class="toolbar-separator"></div>

		<div class="toolbar-group">
			<button
				class="toolbar-btn"
				onclick={formatJson}
				disabled={!hasEditableTab}
				title="Format JSON (Shift+Alt+F)"
				aria-label="Format JSON"
			>
				<Icon name="format" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={compressJson}
				disabled={!hasEditableTab}
				title="Compress JSON"
				aria-label="Compress JSON"
			>
				<Icon name="compress" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={validateJson}
				disabled={!hasEditableTab}
				title="Validate JSON"
				aria-label="Validate JSON"
			>
				<Icon name="validate" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={openJSONRepair}
				disabled={!hasEditableTab}
				title="Repair JSON"
				aria-label="Repair malformed JSON"
			>
				<Icon name="repair" size={16} />
			</button>
		</div>

		<div class="toolbar-separator"></div>

		<div class="toolbar-group">
			<button
				class="toolbar-btn"
				onclick={showFindReplace}
				disabled={!hasEditableTab}
				title="Find & Replace (Ctrl+H)"
				aria-label="Find and replace"
			>
				<Icon name="find-replace" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={openVisualizer}
				disabled={!hasEditableTab}
				title="Visualize JSON"
				aria-label="Visualize JSON"
			>
				<Icon name="visualize" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={openCompare}
				title="Compare JSON"
				aria-label="Compare JSON"
			>
				<Icon name="compare" size={16} />
			</button>
		</div>
	</div>

	<!-- Center section: View mode (hidden for compare tabs) -->
	<div class="toolbar-section center">
		{#if !isCompareTab}
			<div class="view-mode-container">
				<Select
					bind:value={currentViewMode}
					options={viewModeOptions}
					onchange={handleViewModeChange}
					class_="view-mode-select"
					placeholder="Select view mode"
					disabled={!hasEditableTab}
				/>
				<button
					class="toolbar-btn view-mode-info"
					onclick={() => openHelp("viewmodes")}
					title="View mode explanations"
					aria-label="Show view mode information"
				>
					<Icon name="info" size={14} />
				</button>
			</div>
		{:else}
			<div class="compare-mode-indicator">
				<Icon name="compare" size={14} />
				<span>Compare Mode</span>
			</div>
		{/if}
	</div>

	<!-- Right section: Status and settings -->
	<div class="toolbar-section">
		<div class="status-group">
			{#if $currentTab}
				<div class="file-status">
					<span class="file-name">{$currentTab.title}</span>
					{#if !isCompareTab}
						<span
							class="file-dot {$currentTab.isDirty
								? 'dirty'
								: 'clean'}"
						></span>
					{/if}
				</div>
			{/if}

			{#if $validationResult && !isCompareTab}
				<div
					class="validation-status"
					class:valid={$validationResult.valid}
					class:invalid={!$validationResult.valid}
				>
					<Icon
						name={$validationResult.valid ? "success" : "warning"}
						size={12}
					/>
					<span>{$validationResult.valid ? "Valid" : "Invalid"}</span>
				</div>
			{/if}

			{#if autoSaveManager.getSettings().enabled && $currentTab && !isCompareTab}
				<div
					class="autosave-status"
					title={$currentTab.filePath
						? `Auto-save enabled for ${$currentTab.filePath}`
						: "Save file first to enable auto-save"}
				>
					{#if $autoSaveStatus.isSaving}
						<Icon name="loading" size={12} class="spin" />
						<span>Saving...</span>
					{:else if $currentTab.filePath}
						<Icon name="autosave" size={12} />
						<span
							>Auto-save{$autoSaveStatus.lastSaved
								? ` · ${formatLastSaved($autoSaveStatus.lastSaved)}`
								: ""}</span
						>
					{:else}
						<Icon name="autosave" size={12} class="muted" />
						<span class="muted">Auto-save (save first)</span>
					{/if}
				</div>
			{/if}
		</div>

		<div class="toolbar-separator"></div>

		<div class="toolbar-group">
			<button
				class="toolbar-btn"
				onclick={() => openHelp("shortcuts")}
				title="Keyboard Shortcuts"
				aria-label="Keyboard Shortcuts"
			>
				<Icon name="shortcuts" size={16} />
			</button>
			<button
				class="toolbar-btn"
				onclick={openSettings}
				title="Settings"
				aria-label="Open settings"
			>
				<Icon name="settings" size={16} />
			</button>
		</div>
	</div>
</div>

<!-- Help Modal (Shortcuts & View Modes) -->
{#if showHelp}
	<HelpModal bind:show={showHelp} mode={helpMode} onclose={closeAllModals} />
{/if}

<!-- Settings Modal -->
{#if showSettings}
	<SettingsModal bind:show={showSettings} onclose={closeAllModals} />
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		height: 38px;
		padding: 0 16px;
		background: var(--color-toolbar, #292929);
		border-bottom: 1px solid var(--color-border, #333);
		z-index: 1001;
		gap: 8px;
	}

	.toolbar-section {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.toolbar-section.center {
		flex: 1;
		justify-content: center;
		max-width: 300px;
		margin: 0 16px;
	}

	.toolbar-section:last-child {
		margin-left: auto;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.toolbar-separator {
		width: 1px;
		height: 20px;
		background: var(--color-border-secondary, #444);
		margin: 0 8px;
		opacity: 0.5;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--color-text-secondary, #ccc);
		cursor: pointer;
		transition: all 0.15s ease;
		width: 28px;
		height: 28px;
	}

	.toolbar-btn:hover:not(:disabled) {
		background: var(--color-surface-hover, rgba(255, 255, 255, 0.1));
		color: var(--color-text, #fff);
	}

	.toolbar-btn:active {
		transform: scale(0.95);
	}

	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.toolbar-btn:disabled:hover {
		background: none;
		color: var(--color-text-secondary, #ccc);
	}

	.view-mode-container {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	:global(.view-mode-select) {
		min-width: 120px;
	}

	.view-mode-info {
		width: 20px !important;
		height: 20px !important;
		padding: 2px !important;
	}

	.compare-mode-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		background: var(--color-surface-secondary, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--color-border-secondary, #444);
		border-radius: 4px;
		color: var(--color-text-secondary, #ccc);
		font-size: 12px;
		font-weight: 500;
	}

	.status-group {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 12px;
	}

	.file-status {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-text-secondary, #ccc);
	}

	.file-name {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.file-dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		margin-left: 6px;
		display: inline-block;
		box-shadow: 0 0 0 0 transparent;
		transition:
			background 0.2s,
			box-shadow 0.2s;
		vertical-align: middle;
	}
	.file-dot.dirty {
		background: var(--color-warning, #ffc107);
		box-shadow:
			0 0 8px 2px var(--color-warning, #ffc107),
			0 0 2px 1px #fff2;
	}
	.file-dot.clean {
		background: var(--color-success, #28a745);
		box-shadow: 0 0 4px 1px var(--color-success, #28a745);
	}

	.validation-status,
	.autosave-status {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border-radius: 4px;
		font-size: 11px;
		background: var(--color-surface-secondary, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--color-border-secondary, #444);
	}

	.validation-status.valid {
		color: var(--color-success, #28a745);
		border-color: var(--color-success, #28a745);
		background: rgba(40, 167, 69, 0.1);
	}

	.validation-status.invalid {
		color: var(--color-error, #dc3545);
		border-color: var(--color-error, #dc3545);
		background: rgba(220, 53, 69, 0.1);
	}

	.autosave-status {
		color: var(--color-text-muted, #999);
	}

	.autosave-status .muted,
	.autosave-status :global(.muted) {
		opacity: 0.5;
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Responsive design */
	@media (max-width: 768px) {
		.toolbar {
			padding: var(--spacing-xs) var(--spacing-sm);
			min-height: 36px;
		}

		.toolbar-section:not(.center) {
			gap: var(--spacing-xs);
		}

		.toolbar-group {
			gap: 1px;
		}

		.toolbar-btn {
			width: 24px;
			height: 24px;
		}

		.file-name {
			max-width: 120px;
		}

		.status-group {
			gap: var(--spacing-xs);
		}

		.validation-status span,
		.autosave-status span {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.toolbar-separator {
			display: none;
		}

		.toolbar-section.center {
			max-width: 150px;
		}
	}
</style>
