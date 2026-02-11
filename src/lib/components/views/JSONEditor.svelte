<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";
	import { browser } from "$app/environment";
	import { currentTab, tabs } from "$lib/stores/tabs";
	import { shortcutManager } from "$lib/stores/shortcuts";
	import { historyManager } from "$lib/stores/history";
	import { schemaValidator, validationResult } from "$lib/stores/validation";
	import { autoSaveManager } from "$lib/stores/autosave";
	import { fileOperations } from "$lib/services/file";
	import { JSONRepair } from "$lib/services/repair";
	import { FILE_LIMITS } from "$lib/constants";
	import { preferencesService } from "$lib/stores/preferences";
	import Icon from "../ui/Icon.svelte";
	import GridView from "./GridView.svelte";
	import type { Content, OnChange, OnChangeMode, OnSelect, TextSelection, Mode as ModeType, SelectionType as SelectionTypeEnum } from "svelte-jsoneditor";

	interface FindOptions {
		caseSensitive?: boolean;
		wholeWord?: boolean;
		useRegex?: boolean;
	}

	interface ValidationResult {
		valid: boolean;
	}

	interface EditorSelection {
		type: string;
		ranges?: Array<{ anchor: number; head: number }>;
	}

	interface JSONEditorInstance {
		get: () => Content;
		set: (content: Content) => void;
		update: (content: Content) => void;
		select: (selection: TextSelection) => void;
		focus: () => void;
		scrollTo: (path: readonly (string | number)[]) => void;
	}

	type GridRow = Record<string, unknown>;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let JSONEditorComponent: any = $state(null);
	let Mode: typeof ModeType | null = $state(null);
	let SelectionType: typeof SelectionTypeEnum | null = $state(null);

	let {
		error = undefined,
		repaired = undefined,
		validation = undefined,
		modeChange = undefined,
		change = undefined,
		ready = undefined,
	}: {
		error?: (event: { error: string }) => void;
		repaired?: (event: { content: string }) => void;
		validation?: (event: { result: ValidationResult; message: string }) => void;
		modeChange?: (newMode: string, oldMode: string) => void;
		change?: (content: string) => void;
		ready?: (editor: JSONEditorInstance | undefined) => void;
	} = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let editorRef: any = $state(undefined);
	let content: Content = $state({ json: {} });
	let editorMode: string = $state("tree");
	let currentTabId: string | null = $state(null);
	let lastContent = $state("");
	let currentSelection: EditorSelection | undefined = $state(undefined);
	let changeTimeout: ReturnType<typeof setTimeout> | null = null;
	let currentMode: string = $state("tree");
	let showGridView = $state(false);
	let gridData: GridRow[] = $state([]);
	let editorReady = $state(false);
	let isInitializing = $state(false);
	let isModeChanging = $state(false);
	let unsubscribeTab: (() => void) | null = null;
	let isLargeFile = $state(false);

	// Get the preferences store for reactive updates
	const preferences = preferencesService.getStore();

	// Reactive editor styles based on preferences
	let editorStyles = $derived(
		`--editor-font-family: ${$preferences.editor.fontFamily}; --editor-font-size: ${$preferences.editor.fontSize}px;`
	);

	// Large file detection
	function checkIfLargeFile(contentStr: string): boolean {
		const size = new Blob([contentStr]).size;
		isLargeFile = size > FILE_LIMITS.LARGE_FILE_THRESHOLD;
		return isLargeFile;
	}

	// Check if a mode is allowed for the current file
	export function isModeAllowed(mode: string): { allowed: boolean; reason?: string } {
		if (!isLargeFile) {
			return { allowed: true };
		}

		// For large files, only tree mode is allowed (has lazy rendering)
		if (mode === "tree") {
			return { allowed: true };
		}

		return {
			allowed: false,
			reason: "Large files can only be viewed in Tree mode for performance reasons"
		};
	}

	// Export to allow parent components to check large file status
	export function getIsLargeFile(): boolean {
		return isLargeFile;
	}

	const handleChange: OnChange = (
		updatedContent: Content,
		_previousContent: Content,
		_changeStatus
	) => {
		if (isInitializing || isModeChanging) return;

		try {
			let jsonString: string;

			if ('text' in updatedContent && updatedContent.text !== undefined) {
				jsonString = updatedContent.text;
			} else if ('json' in updatedContent && updatedContent.json !== undefined) {
				jsonString = JSON.stringify(updatedContent.json, null, 2);
			} else {
				return;
			}

			if (jsonString === lastContent) {
				return;
			}

			// Update immediately to prevent feedback loop
			lastContent = jsonString;

			// Debounced history saving
			if (changeTimeout) clearTimeout(changeTimeout);
			changeTimeout = setTimeout(() => {
				if (currentTabId) {
					historyManager.saveState(currentTabId, lastContent);
				}
			}, 300);

			if (currentTabId) {
				tabs.updateContent(currentTabId, jsonString);
				autoSaveManager.markActivity(currentTabId, jsonString);
			}

			change?.(jsonString);
		} catch (err) {
			console.error("Error handling change:", err);
		}
	};

	const handleModeChange: OnChangeMode = (mode) => {
		currentMode = mode as string;
		editorMode = mode as string;
		modeChange?.(mode as string, currentMode);
	};

	const handleSelect: OnSelect = (selection) => {
		currentSelection = selection;
	};

	function handleError(err: Error | string) {
		console.error("JSON Editor Error:", err);
		if (err && typeof err === "object" && err.message) {
			error?.({ error: err.message });
		} else if (typeof err === "string") {
			error?.({ error: err });
		} else {
			error?.({ error: "Editor error occurred" });
		}
	}

	function setupKeyboardShortcuts() {
		const shortcuts = {
			undo: () => performUndo(),
			redo: () => performRedo(),
			find: () => showFindReplace(),
			replace: () => showFindReplace(),
			format: () => format(),
			validate: () => validateContent(),
		};

		Object.entries(shortcuts).forEach(([action, handler]) => {
			shortcutManager.registerAction(action, handler);
		});
	}

	function setupAutoSave() {
		// Content provider for autosave
		autoSaveManager.setContentProvider((tabId: string) => {
			return currentTabId === tabId ? getContent() : "";
		});

		// Save callback - only saves files that have a filePath (already saved before)
		autoSaveManager.setSaveCallback(async (tabId: string, contentStr: string) => {
			const allTabs = tabs.getTabs();
			const tab = allTabs.find(t => t.id === tabId);

			// Only auto-save if the file has been saved before (has a path)
			if (!tab || !tab.filePath) {
				return;
			}

			try {
				await fileOperations.saveFile(tab.filePath, contentStr);
				// Mark tab as not dirty after successful save
				tabs.markSaved(tabId, tab.filePath);
			} catch (saveError) {
				console.error('Auto-save failed:', saveError);
				throw saveError;
			}
		});
	}

	export function performUndo() {
		if (currentTabId && historyManager.canUndo(currentTabId)) {
			const state = historyManager.undo(currentTabId);
			if (state && editorRef) {
				isInitializing = true;
				setContent(state.content);
				lastContent = state.content;
				isInitializing = false;

				if (currentTabId) {
					tabs.updateContent(currentTabId, state.content);
				}
			}
		}
	}

	export function performRedo() {
		if (currentTabId && historyManager.canRedo(currentTabId)) {
			const state = historyManager.redo(currentTabId);
			if (state && editorRef) {
				isInitializing = true;
				setContent(state.content);
				lastContent = state.content;
				isInitializing = false;

				if (currentTabId) {
					tabs.updateContent(currentTabId, state.content);
				}
			}
		}
	}

	function showFindReplace() {
		window.dispatchEvent(new CustomEvent("show-find-replace"));
	}

	function validateContent() {
		if (currentTabId && schemaValidator.hasSchema() && editorRef) {
			const contentStr = getContent();
			const result = schemaValidator.validateJSON(contentStr);
			validationResult.set(result);

			const message = result.valid
				? "JSON is valid!"
				: `JSON has ${result.errors.length} error(s)`;
			if (typeof validation === "function") validation({ result: { valid: result.valid }, message });
		}
	}

	export function getContent(): string {
		if (editorRef) {
			try {
				const currentContent = editorRef.get();
				if ('text' in currentContent && currentContent.text !== undefined) {
					return currentContent.text;
				} else if ('json' in currentContent && currentContent.json !== undefined) {
					return JSON.stringify(currentContent.json, null, 2);
				}
				return "{}";
			} catch (err) {
				console.error("Error getting content:", err);
				return "{}";
			}
		}
		return "{}";
	}

	export function setContent(newContent: string) {
		if (!editorRef) return;

		try {
			isInitializing = true;

			// Check if large file
			checkIfLargeFile(newContent);

			if (!newContent || newContent.trim() === "") {
				content = { json: {} };
				lastContent = "{}";
			} else {
				try {
					const jsonData = JSON.parse(newContent);
					content = { json: jsonData };
					lastContent = newContent;
				} catch (parseError) {
					// Invalid JSON - treat as raw text
					content = { text: newContent };
					lastContent = newContent;
				}
			}

			if (currentTabId) {
				historyManager.saveState(currentTabId, lastContent);
			}

			setTimeout(() => {
				isInitializing = false;
			}, 50);
		} catch (err) {
			console.error("Error setting content:", err);
			content = { json: {} };
			lastContent = "{}";
			isInitializing = false;
		}
	}

	// Mode switching supports tree, text, and custom grid view
	export async function setMode(mode: string) {
		const oldMode = currentMode;

		// Check if mode is allowed for large files
		const modeCheck = isModeAllowed(mode);
		if (!modeCheck.allowed) {
			console.warn(`Mode "${mode}" not allowed: ${modeCheck.reason}`);
			return;
		}

		if (mode === "grid") {
			currentMode = mode;
			handleGridView();
			modeChange?.(mode, oldMode);
			return;
		}

		// Only tree and text modes are supported by svelte-jsoneditor
		if (!["tree", "text"].includes(mode)) {
			mode = "text";
		}

		if (showGridView) {
			showGridView = false;
		}

		if (isModeChanging || isInitializing) {
			setTimeout(() => setMode(mode), 200);
			return;
		}

		currentMode = mode;
		editorMode = mode;

		modeChange?.(mode, oldMode);
	}

	export function format() {
		try {
			const contentStr = getContent();
			const formatted = JSON.stringify(JSON.parse(contentStr), null, 2);
			setContent(formatted);

			if (currentTabId) {
				historyManager.saveState(currentTabId, formatted);
				lastContent = formatted;
			}
		} catch (err) {
			console.error("Error formatting:", err);
			error?.({ error: "Invalid JSON - cannot format" });
		}
	}

	export function repair() {
		try {
			const contentStr = getContent();
			const result = JSONRepair.repair(contentStr);

			if (result.success) {
				setContent(result.repairedJSON);
				repaired?.({ content: result.repairedJSON });
			} else {
				// Even if repair wasn't fully successful, apply partial fixes if available
				if (result.repairedJSON !== contentStr) {
					setContent(result.repairedJSON);
					repaired?.({ content: result.repairedJSON });
				}

				const errorMessages = result.errors.join('; ');
				error?.({ error: errorMessages || "Failed to repair JSON" });
			}
		} catch (err) {
			console.error("Error repairing JSON:", err);
			error?.({ error: "Failed to repair JSON" });
		}
	}

	function handleGridView() {
		try {
			const contentStr = getContent();
			const json = JSON.parse(contentStr);

			if (
				Array.isArray(json) &&
				json.length > 0 &&
				typeof json[0] === "object"
			) {
				gridData = json as GridRow[];
				showGridView = true;
			} else if (typeof json === "object" && json !== null) {
				gridData = Object.entries(json).map(([key, value]) => ({
					key,
					value,
				}));
				showGridView = true;
			} else {
				error?.({
					error: "Grid view is only available for arrays of objects or objects",
				});
				showGridView = false;
				currentMode = "tree";
				editorMode = Mode?.tree ?? "tree";
				modeChange?.("tree", "grid");
			}
		} catch (err) {
			console.error("Error in handleGridView:", err);
			error?.({ error: "Invalid JSON - cannot display grid view" });
			showGridView = false;
			currentMode = "tree";
			editorMode = Mode?.tree ?? "tree";
			modeChange?.("tree", "grid");
		}
	}

	function handleCloseGridView() {
		showGridView = false;
		const oldMode = currentMode;
		currentMode = "tree";
		editorMode = Mode?.tree ?? "tree";
		modeChange?.("tree", oldMode);
	}

	// Find/Replace helpers
	function buildRegex(term: string, opts: FindOptions) {
		const { caseSensitive = false, wholeWord = false, useRegex = false } = opts || {};
		const flags = caseSensitive ? "g" : "gi";
		let source = useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (wholeWord) {
			source = `\\b${source}\\b`;
		}
		try {
			return new RegExp(source, flags);
		} catch (e) {
			return null;
		}
	}

	function getTextContent(): string {
		try {
			const c = editorRef?.get();
			if (!c) return "";
			if ('text' in c && c.text !== undefined) return c.text;
			if ('json' in c && c.json !== undefined) return JSON.stringify(c.json, null, 2);
			return "";
		} catch {
			return "";
		}
	}

	function ensureTextMode() {
		if (currentMode !== "text") {
			try {
				editorMode = Mode?.text ?? "text";
				currentMode = "text";
			} catch {}
		}
	}

	function selectRange(from: number, to: number) {
		try {
			if (!SelectionType) return;
			// TextSelection object per svelte-jsoneditor API
			const selection: TextSelection = {
				type: SelectionType.text,
				ranges: [{ anchor: from, head: to }],
				main: 0,
			};
			editorRef?.select(selection);
			editorRef?.focus();
		} catch (e) {
			console.warn("Failed to select range", e);
		}
	}

	function findNextIndex(text: string, regex: RegExp, startIndex: number) {
		regex.lastIndex = startIndex;
		const m = regex.exec(text);
		if (m) {
			return { from: m.index, to: m.index + m[0].length };
		}
		// Wrap around to start
		regex.lastIndex = 0;
		const m2 = regex.exec(text);
		if (m2) {
			return { from: m2.index, to: m2.index + m2[0].length };
		}
		return null;
	}

	function currentCursor(_text: string): number {
		if (currentSelection && currentSelection.type === "text" && currentSelection.ranges?.length) {
			const r = currentSelection.ranges[0];
			return Math.max(r.anchor, r.head);
		}
		return 0;
	}

	export function findInEditor(term: string, options: FindOptions = {}) {
		if (!editorRef || !term) return;
		ensureTextMode();
		const text = getTextContent();
		const regex = buildRegex(term, options);
		if (!regex) {
			error?.({ error: "Invalid regular expression" });
			return;
		}
		const start = currentCursor(text);
		const match = findNextIndex(text, regex, start);
		if (match) {
			selectRange(match.from, match.to);
		}
	}

	export function replaceInEditor(findTerm: string, replaceTerm: string, options: FindOptions = {}) {
		if (!editorRef || !findTerm) return;
		ensureTextMode();
		const text = getTextContent();
		const regex = buildRegex(findTerm, options);
		if (!regex) {
			error?.({ error: "Invalid regular expression" });
			return;
		}
		const start = currentCursor(text);
		const match = findNextIndex(text, regex, start);
		if (!match) return;
		const before = text.slice(0, match.from);
		const after = text.slice(match.to);
		const replacement = replaceTerm;
		const updated = before + replacement + after;
		try {
			content = { text: updated };
			lastContent = updated;
			const to = before.length + replacement.length;
			selectRange(before.length, to);
			if (currentTabId) {
				tabs.updateContent(currentTabId, updated);
				autoSaveManager.markActivity(currentTabId, updated);
			}
			change?.(updated);
		} catch (e) {
			console.error("Replace failed", e);
		}
	}

	export function replaceAllInEditor(findTerm: string, replaceTerm: string, options: FindOptions = {}) {
		if (!editorRef || !findTerm) return;
		ensureTextMode();
		const text = getTextContent();
		const regex = buildRegex(findTerm, options);
		if (!regex) {
			error?.({ error: "Invalid regular expression" });
			return;
		}
		const updated = text.replace(regex, replaceTerm);
		if (updated === text) return;
		try {
			content = { text: updated };
			lastContent = updated;
			selectRange(updated.length, updated.length);
			if (currentTabId) {
				tabs.updateContent(currentTabId, updated);
				autoSaveManager.markActivity(currentTabId, updated);
			}
			change?.(updated);
		} catch (e) {
			console.error("Replace all failed", e);
		}
	}

	onMount(async () => {
		if (browser) {
			// Dynamically import svelte-jsoneditor to avoid SSR issues with svelte-awesome
			try {
				const module = await import("svelte-jsoneditor");
				JSONEditorComponent = module.JSONEditor;
				Mode = module.Mode;
				SelectionType = module.SelectionType;
				editorMode = module.Mode.tree;
			} catch (err) {
				console.error("Failed to load svelte-jsoneditor:", err);
				return;
			}

			// Setup keyboard shortcuts and autosave
			setupKeyboardShortcuts();
			setupAutoSave();

			// Mark editor as ready after a short delay to ensure component is mounted
			await tick();
			editorReady = true;
			ready?.(editorRef);

			// Subscribe to tab changes
			unsubscribeTab = currentTab.subscribe((tab) => {
				if (!tab) return;

				if (!editorRef) {
					currentTabId = tab.id;
					return;
				}

				// Tab switch
				if (currentTabId !== tab.id) {
					if (currentTabId) {
						autoSaveManager.cleanup(currentTabId);
					}
					currentTabId = tab.id;

					if (showGridView) {
						showGridView = false;
						const oldMode = currentMode;
						currentMode = "tree";
						editorMode = Mode?.tree ?? "tree";
						modeChange?.("tree", oldMode);
					}

					try {
						const tabContent = tab.content || "{}";
						setContent(tabContent);
						lastContent = tabContent;
						autoSaveManager.startAutoSave(tab.id);
						if (schemaValidator.hasSchema()) {
							try {
								const parsed = JSON.parse(tabContent);
								const result = schemaValidator.validate(parsed);
								validationResult.set(result);
							} catch {}
						}
					} catch (err) {
						console.error("Error setting editor content:", err);
						setContent("{}");
						lastContent = "{}";
					}
					return;
				}

				// Same tab - only update if content changed externally
				const tabContent = tab.content || "{}";
				if (
					tabContent !== lastContent &&
					!isInitializing &&
					!isModeChanging
				) {
					try {
						setContent(tabContent);
						lastContent = tabContent;
						if (schemaValidator.hasSchema()) {
							try {
								const parsed = JSON.parse(tabContent);
								const result = schemaValidator.validate(parsed);
								validationResult.set(result);
							} catch {}
						}
					} catch (err) {
						console.error("Error updating editor content:", err);
					}
				}
			});
		}
	});

	onDestroy(() => {
		if (currentTabId) {
			autoSaveManager.cleanup(currentTabId);
		}

		if (changeTimeout) {
			clearTimeout(changeTimeout);
		}

		if (unsubscribeTab) {
			unsubscribeTab();
			unsubscribeTab = null;
		}

		editorReady = false;
		isInitializing = false;
	});
</script>

<div class="json-editor-container" style={editorStyles}>
	<div
		class="jsoneditor-wrapper"
		class:hidden={showGridView}
		class:loading={!editorReady}
		class:hide-line-numbers={!$preferences.editor.showLineNumbers}
		class:word-wrap={$preferences.editor.wordWrap}
		role="textbox"
		aria-label="JSON editor"
		aria-multiline="true"
	>
		{#if browser && JSONEditorComponent}
			<JSONEditorComponent
				bind:this={editorRef}
				{content}
				mode={editorMode}
				mainMenuBar={false}
				navigationBar={false}
				statusBar={true}
				readOnly={false}
				onChange={handleChange}
				onChangeMode={handleModeChange}
				onSelect={handleSelect}
				onError={handleError}
			/>
		{/if}
	</div>

	{#if !editorReady}
		<div class="editor-loading">
			<Icon name="loading" size={24} class="spin" />
			<span>Loading Editor...</span>
		</div>
	{:else if showGridView}
		<GridView data={gridData} onClose={handleCloseGridView} />
	{/if}
</div>

<style>
	.json-editor-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-editor-background, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		overflow: hidden;
		position: relative;
	}

	.editor-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: var(--spacing-md);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
	}

	.jsoneditor-wrapper {
		height: 100%;
		width: 100%;
		min-height: 200px;
	}

	.jsoneditor-wrapper.loading {
		opacity: 0;
		pointer-events: none;
	}

	.jsoneditor-wrapper.hidden {
		display: none;
	}

	:global(.json-editor-container .cm-editor),
	:global(.json-editor-container .cm-content),
	:global(.json-editor-container .cm-line),
	:global(.json-editor-container .jse-contents),
	:global(.json-editor-container .jse-tree),
	:global(.json-editor-container .jse-value),
	:global(.json-editor-container .jse-key),
	:global(.json-editor-container .jse-text-mode) {
		font-family: var(--editor-font-family, 'JetBrains Mono', monospace) !important;
		font-size: var(--editor-font-size, 14px) !important;
	}

	:global(.json-editor-container .cm-gutters),
	:global(.json-editor-container .cm-lineNumbers) {
		font-family: var(--editor-font-family, 'JetBrains Mono', monospace) !important;
		font-size: var(--editor-font-size, 14px) !important;
	}

	.jsoneditor-wrapper.hide-line-numbers :global(.cm-gutters) {
		display: none !important;
	}

	.jsoneditor-wrapper.word-wrap :global(.cm-content) {
		white-space: pre-wrap !important;
		word-break: break-word !important;
	}

	.jsoneditor-wrapper.word-wrap :global(.cm-line) {
		white-space: pre-wrap !important;
		word-break: break-word !important;
	}

	.jsoneditor-wrapper:not(.word-wrap) :global(.cm-content) {
		white-space: pre !important;
	}

	.jsoneditor-wrapper:not(.word-wrap) :global(.cm-line) {
		white-space: pre !important;
	}

	:global(.jsoneditor-wrapper .jse-main) {
		background: var(--color-editor-background, var(--color-surface)) !important;
		color: var(--color-editor-foreground, var(--color-text)) !important;
		border: none !important;
		height: 100% !important;
	}

	:global(.jsoneditor-wrapper .jse-menu) {
		background: var(--color-surface-secondary) !important;
		border-bottom: 1px solid var(--color-border) !important;
	}

	:global(.jsoneditor-wrapper .jse-contents) {
		background: var(--color-editor-background, var(--color-surface)) !important;
		color: var(--color-editor-foreground, var(--color-text)) !important;
	}

	:global(.jsoneditor-wrapper .jse-key) {
		color: var(--color-syntax-key) !important;
	}

	:global(.jsoneditor-wrapper .jse-value.jse-string) {
		color: var(--color-syntax-string) !important;
	}

	:global(.jsoneditor-wrapper .jse-value.jse-number) {
		color: var(--color-syntax-number) !important;
	}

	:global(.jsoneditor-wrapper .jse-value.jse-boolean) {
		color: var(--color-syntax-boolean) !important;
	}

	:global(.jsoneditor-wrapper .jse-value.jse-null) {
		color: var(--color-syntax-null) !important;
	}

	:global(.jsoneditor-wrapper .jse-index) {
		color: var(--color-text-muted) !important;
	}

	:global(.jsoneditor-wrapper .jse-delimiter) {
		color: var(--color-syntax-operator) !important;
	}

	:global(.jsoneditor-wrapper .jse-bracket) {
		color: var(--color-syntax-operator) !important;
	}

	:global(.jsoneditor-wrapper .cm-editor) {
		background: var(--color-editor-background, var(--color-surface)) !important;
		color: var(--color-editor-foreground, var(--color-text)) !important;
	}

	:global(.jsoneditor-wrapper .cm-content) {
		color: var(--color-editor-foreground, var(--color-text)) !important;
		background: transparent !important;
	}

	:global(.jsoneditor-wrapper .cm-editor.cm-focused) {
		outline: none !important;
	}

	:global(.jsoneditor-wrapper .cm-gutters),
	:global(.jse-text-mode .cm-gutters) {
		background: var(--color-editor-background, var(--color-surface)) !important;
		border-right: 1px solid var(--color-border) !important;
		color: var(--color-text-muted, #6e7681) !important;
	}

	:global(.jsoneditor-wrapper .cm-gutter),
	:global(.jse-text-mode .cm-gutter) {
		background: transparent !important;
	}

	:global(.jsoneditor-wrapper .cm-lineNumbers),
	:global(.jse-text-mode .cm-lineNumbers) {
		color: var(--color-text-muted, #6e7681) !important;
	}

	:global(.jsoneditor-wrapper .cm-lineNumbers .cm-gutterElement),
	:global(.jse-text-mode .cm-lineNumbers .cm-gutterElement) {
		color: var(--color-text-muted, #6e7681) !important;
		padding: 0 8px 0 12px !important;
	}

	:global(.jsoneditor-wrapper .cm-activeLineGutter),
	:global(.jse-text-mode .cm-activeLineGutter) {
		background: var(--color-editor-line-highlight, rgba(255, 255, 255, 0.05)) !important;
		color: var(--color-text-secondary, #8b949e) !important;
	}

	:global(.jsoneditor-wrapper .cm-cursor) {
		border-left: 2px solid var(--color-border-focus, #007acc) !important;
		animation: blink 1s step-end infinite !important;
		box-shadow: 0 0 2px var(--color-border-focus, #007acc) !important;
	}

	@keyframes blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0.3; }
	}

	:global(.jsoneditor-wrapper .cm-selectionBackground) {
		background: var(--color-editor-selection, rgba(0, 122, 204, 0.3)) !important;
	}

	:global(.jsoneditor-wrapper .cm-activeLine) {
		background: var(--color-editor-line-highlight, rgba(255, 255, 255, 0.03)) !important;
	}

	:global(.jsoneditor-wrapper .cm-line .ͼo) {
		color: var(--color-syntax-key) !important;
	}

	:global(.jsoneditor-wrapper .cm-line .ͼr) {
		color: var(--color-syntax-string) !important;
	}

	:global(.jsoneditor-wrapper .cm-line .ͼn) {
		color: var(--color-syntax-number) !important;
	}

	:global(.jsoneditor-wrapper .cm-line .ͼb) {
		color: var(--color-syntax-boolean) !important;
	}

	:global(.jsoneditor-wrapper .cm-line .ͼa) {
		color: var(--color-syntax-null) !important;
	}

	:global(.jsoneditor-wrapper .cm-line) {
		color: var(--color-syntax-operator) !important;
	}

	:global(.jsoneditor-wrapper .cm-activeLine) {
		background: var(--color-editor-line-highlight) !important;
	}

	:global(.jsoneditor-wrapper .jse-tree) {
		color: var(--color-editor-foreground, var(--color-text)) !important;
	}

	:global(.jsoneditor-wrapper .jse-text-mode .cm-line) {
		color: var(--color-editor-foreground, var(--color-text)) !important;
	}

	:global(.jsoneditor-wrapper .jse-button) {
		background: var(--color-surface) !important;
		color: var(--color-text) !important;
		border: 1px solid var(--color-border) !important;
	}

	:global(.jsoneditor-wrapper .jse-button:hover) {
		background: var(--color-surface-hover) !important;
	}

	:global(.jsoneditor-wrapper .jse-tree-node) {
		border-radius: 3px !important;
		transition: background-color 0.15s ease !important;
	}

	:global(.jsoneditor-wrapper .jse-tree-node:hover) {
		background: var(--color-surface-hover) !important;
	}

	:global(.jsoneditor-wrapper .jse-tree-node.jse-selected) {
		background: var(--color-editor-selection, rgba(0, 122, 204, 0.3)) !important;
		border: 1px solid var(--color-border-focus, #007acc) !important;
	}

	:global(.jsoneditor-wrapper .jse-tree-node:focus) {
		background: var(--color-editor-selection, rgba(0, 122, 204, 0.2)) !important;
		outline: 2px solid var(--color-border-focus, #007acc) !important;
		outline-offset: 1px !important;
	}

	:global(.jsoneditor-wrapper .jse-expand) {
		background: transparent !important;
		color: var(--color-text-secondary) !important;
		border: none !important;
		opacity: 0.7;
		transition: opacity 0.2s ease, color 0.2s ease, background-color 0.2s ease;
		border-radius: 2px !important;
	}

	:global(.jsoneditor-wrapper .jse-expand:hover) {
		opacity: 1;
		color: var(--color-text) !important;
		background: var(--color-surface-hover) !important;
	}

	:global(.jsoneditor-wrapper .jse-expand svg) {
		fill: currentColor !important;
	}

	:global(.jsoneditor-wrapper .jse-context-menu) {
		background: var(--color-surface) !important;
		border: 1px solid var(--color-border) !important;
		color: var(--color-text) !important;
	}

	:global(.jsoneditor-wrapper .jse-context-menu .jse-menu-item) {
		color: var(--color-text) !important;
	}

	:global(.jsoneditor-wrapper .jse-context-menu .jse-menu-item:hover) {
		background: var(--color-surface-hover) !important;
	}

	:global(.jse-search-box-background) {
		background: var(--color-surface-secondary) !important;
		border: none !important;
	}

	:global(.jsoneditor-wrapper .jse-status-bar),
	:global(.jse-status-bar) {
		background: var(--color-editor-background, var(--color-surface)) !important;
		border-top: 1px solid var(--color-border) !important;
		color: var(--color-text-secondary, #8b949e) !important;
	}

	:global(.jsoneditor-wrapper .jse-status-bar-info),
	:global(.jse-status-bar-info) {
		color: var(--color-text-secondary, #8b949e) !important;
	}

	:global(.jsoneditor-wrapper .jse-status-bar button),
	:global(.jse-status-bar button) {
		color: var(--color-text-secondary, #8b949e) !important;
		background: transparent !important;
	}

	:global(.jsoneditor-wrapper .jse-status-bar button:hover),
	:global(.jse-status-bar button:hover) {
		color: var(--color-text) !important;
		background: var(--color-surface-hover) !important;
	}

	.jsoneditor-wrapper.hidden {
		display: none !important;
	}
</style>
