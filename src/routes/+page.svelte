<script lang="ts">
	// Layout components
	import TabManager from "$lib/components/layout/TabManager.svelte";
	import Toolbar from "$lib/components/layout/Toolbar.svelte";
	import Sidebar from "$lib/components/layout/Sidebar.svelte";

	// View components
	import JSONEditor from "$lib/components/views/JSONEditor.svelte";
	import CompareView from "$lib/components/views/CompareView.svelte";
	import JSONTreeVisualizer from "$lib/components/views/JSONTreeVisualizer.svelte";
	import GraphVisualizer from "$lib/components/views/GraphVisualizer.svelte";

	// Modal components
	import ExportModal from "$lib/components/modals/ExportModal.svelte";
	import JSONRepairModal from "$lib/components/modals/JSONRepairModal.svelte";
	import PathFinderModal from "$lib/components/modals/PathFinderModal.svelte";
	import JSONQueryModal from "$lib/components/modals/JSONQueryModal.svelte";
	import SnippetManagerModal from "$lib/components/modals/SnippetManagerModal.svelte";
	import FindReplaceModal from "$lib/components/modals/FindReplaceModal.svelte";
	import SchemaModal from "$lib/components/modals/SchemaModal.svelte";
	import BatchOperationsModal from "$lib/components/modals/BatchOperationsModal.svelte";
	import TypeGeneratorModal from "$lib/components/modals/TypeGeneratorModal.svelte";
	import ImportModal from "$lib/components/modals/ImportModal.svelte";
	import HelpModal from "$lib/components/modals/HelpModal.svelte";

	// UI components
	import EmptyState from "$lib/components/ui/EmptyState.svelte";

	// Stores and services
	import { tabs, currentTab } from "$lib/stores/tabs";
	import { showSchemaModal } from "$lib/stores/validation";
	import { preferencesService } from "$lib/stores/preferences";
	import { fileOperations } from "$lib/services/file";
	import { FileImporter } from "$lib/services/import";
	import { databaseService } from "$lib/stores/database";
	import { onMount } from "svelte";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import { invoke } from "@tauri-apps/api/core";
	import { open } from "@tauri-apps/plugin-shell";
	import { APP, BYTES, FILE_LIMITS } from "$lib/constants";
	import type { QueryEngine } from "$lib/services/query";
	import welcomeData from "$lib/data/welcome.json";

	interface FindOptions {
		caseSensitive: boolean;
		wholeWord: boolean;
		useRegex: boolean;
	}

	interface NotificationEvent {
		type: string;
		message: string;
	}

	interface ValidationResultEvent {
		result: { valid: boolean };
		message: string;
	}

	// Modal states (showCompare removed - now uses tab-based view)
	let showImport = $state(false);
	let showVisualizer = $state(false);
	let showExport = $state(false);
	let showJSONRepair = $state(false);
	let showPathFinder = $state(false);
	let showImprovedQuery = $state(false);
	let showSnippetManager = $state(false);
	let showFindReplace = $state(false);
	let showBatchOperations = $state(false);
	let showAdvancedVisualizer = $state(false);
	let showTypeGenerator = $state(false);
	let showHelp = $state(false);
	let helpMode: "shortcuts" | "viewmodes" = $state("shortcuts");
	let notifications: Array<{
		id: string;
		type: string;
		message: string;
		timeout?: number;
	}> = $state([]);

	// Menu event listener
	let unlistenMenu: UnlistenFn | null = null;
	let unlistenFileOpen: UnlistenFn | null = null;

	// Editor reference
	let jsonEditor: JSONEditor | undefined = $state();
	let toolbar: Toolbar | undefined = $state();

	onMount(() => {
		// Async initialization wrapped in IIFE
		(async () => {
			// Initialize stores
			await preferencesService.init();

			// Run database cleanup on startup (removes old buffers, orphaned data)
			await databaseService.runStartupCleanup();

			// Check if this is a first-time user
			const isFirstTime = preferencesService.isFirstTime();

			// Create welcome tab only for first-time users
			if ($tabs.length === 0 && isFirstTime) {
				// Update version from constants to ensure consistency
				const welcome = { ...welcomeData, version: APP.VERSION };
				await tabs.add({
					title: "Welcome to Pandia.json",
					content: JSON.stringify(welcome, null, 2),
					isDirty: false,
					isNew: false,
				});

				// Mark as not first time after showing welcome
				await preferencesService.markNotFirstTime();
			}

			// Listen for menu events from Tauri
			unlistenMenu = await listen<string>("menu-event", (event) => {
				handleMenuAction(event.payload);
			});

			// Listen for file open events (file association / "Open with")
			unlistenFileOpen = await listen<string[]>("file-open", (event) => {
				handleFileOpen(event.payload);
			});

			// Check for any pending files (opened via CLI or before frontend was ready)
			try {
				const pendingFiles =
					await invoke<string[]>("get_pending_files");
				if (pendingFiles && pendingFiles.length > 0) {
					await handleFileOpen(pendingFiles);
				}
			} catch (error) {
				console.error("Failed to get pending files:", error);
			}

			// Sync recent files menu with Tauri
			await syncRecentFilesMenu();
		})();

		// Subscribe to preferences changes to update recent files menu
		const unsubPrefs = preferencesService.getStore().subscribe(async () => {
			await syncRecentFilesMenu();
		});

		// Set up custom event listeners
		const handleShowFindReplace = () => {
			showFindReplace = true;
		};
		window.addEventListener("show-find-replace", handleShowFindReplace);

		return () => {
			window.removeEventListener(
				"show-find-replace",
				handleShowFindReplace,
			);
			if (unlistenMenu) {
				unlistenMenu();
			}
			if (unlistenFileOpen) {
				unlistenFileOpen();
			}
			unsubPrefs();
		};
	});

	// Sync recent files menu with native Tauri menu
	async function syncRecentFilesMenu() {
		try {
			const recentFiles = preferencesService.getRecentFiles();
			await invoke("update_recent_files_menu", {
				recentFiles: recentFiles.map((f) => ({
					path: f.path,
					name: f.name,
				})),
			});
		} catch (error) {
			console.error("Failed to sync recent files menu:", error);
		}
	}

	// Open a file from a file path (used by file association and recent files)
	async function openFileFromPath(filePath: string) {
		try {
			// Extract filename from path
			const pathParts = filePath.split(/[/\\]/);
			let fileName = pathParts[pathParts.length - 1] || "Untitled.json";

			// Check if file is already open
			const existingTab = $tabs.find((t) => t.filePath === filePath);
			if (existingTab) {
				// Switch to existing tab instead of opening duplicate
				tabs.setCurrentTab(existingTab.id);
				return;
			}

			const rawContent = await fileOperations.readFileContent(filePath);

			// Parse and convert to JSON using FileImporter (like import modal does)
			const result = await FileImporter.parse(rawContent, {
				filename: fileName,
			});

			let finalContent: string;
			let finalFileName = fileName;

			if (result.success) {
				// Convert to formatted JSON
				finalContent = FileImporter.toJSON(result.data, 2);

				// Update filename extension to .json if it was converted from another format
				if (
					result.originalFormat !== "json" &&
					!fileName.endsWith(".json")
				) {
					const baseName = fileName.replace(/\.[^.]+$/, "");
					finalFileName = `${baseName}.json`;
				}
			} else {
				// Fallback to raw content if parsing fails
				finalContent = rawContent;
			}

			await tabs.add({
				title: finalFileName,
				content: finalContent,
				filePath: filePath,
				isDirty: result.success && result.originalFormat !== "json", // Mark dirty if converted
				isNew: false,
			});
			// Add to recent files
			await preferencesService.addRecentFile({
				path: filePath,
				name: fileName,
				type: fileName.endsWith(".json") ? "json" : "text",
			});

			if (result.success && result.originalFormat !== "json") {
				showNotification(
					"success",
					`Opened and converted ${fileName} from ${result.originalFormat.toUpperCase()} to JSON`,
				);
			} else {
				showNotification("success", `Opened ${fileName}`);
			}
		} catch (error) {
			showNotification("error", `Failed to open file: ${error}`);
		}
	}

	// Handle multiple files opened via file association
	async function handleFileOpen(filePaths: string[]) {
		for (const filePath of filePaths) {
			await openFileFromPath(filePath);
		}
	}

	// Open a file from recent files list
	async function openRecentFile(filePath: string, fileName: string) {
		try {
			// Check if file is already open
			const existingTab = $tabs.find((t) => t.filePath === filePath);
			if (existingTab) {
				// Switch to existing tab instead of opening duplicate
				tabs.setCurrentTab(existingTab.id);
				return;
			}

			const rawContent = await fileOperations.readFileContent(filePath);

			// Parse and convert to JSON using FileImporter
			const result = await FileImporter.parse(rawContent, {
				filename: fileName,
			});

			let finalContent: string;
			let finalFileName = fileName;

			if (result.success) {
				finalContent = FileImporter.toJSON(result.data, 2);
				if (
					result.originalFormat !== "json" &&
					!fileName.endsWith(".json")
				) {
					const baseName = fileName.replace(/\.[^.]+$/, "");
					finalFileName = `${baseName}.json`;
				}
			} else {
				finalContent = rawContent;
			}

			await tabs.add({
				title: finalFileName,
				content: finalContent,
				filePath: filePath,
				isDirty: result.success && result.originalFormat !== "json",
				isNew: false,
			});
			// Update the file's lastOpened timestamp
			await preferencesService.addRecentFile({
				path: filePath,
				name: fileName,
				type: fileName.endsWith(".json") ? "json" : "text",
			});

			if (result.success && result.originalFormat !== "json") {
				showNotification(
					"success",
					`Opened and converted ${fileName} from ${result.originalFormat.toUpperCase()} to JSON`,
				);
			} else {
				showNotification("success", `Opened ${fileName}`);
			}
		} catch (error) {
			showNotification("error", `Failed to open file: ${error}`);
			// Remove from recent files if file no longer exists
			await preferencesService.removeRecentFile(filePath);
		}
	}

	// Handle menu actions from native macOS menu
	async function handleMenuAction(menuId: string) {
		// Handle recent file clicks (recent_file_0, recent_file_1, etc.)
		if (menuId.startsWith("recent_file_")) {
			const index = parseInt(menuId.replace("recent_file_", ""), 10);
			const recentFiles = preferencesService.getRecentFiles();
			if (index >= 0 && index < recentFiles.length) {
				const file = recentFiles[index];
				await openRecentFile(file.path, file.name);
			}
			return;
		}

		switch (menuId) {
			// File menu
			case "new_file":
				await tabs.add({
					title: "Untitled.json",
					content: "{\n  \n}",
					isDirty: false,
					isNew: true,
				});
				break;
			case "open_file":
				try {
					const fileResult = await fileOperations.openFile();
					if (fileResult) {
						// Parse and convert to JSON using FileImporter
						const parseResult = await FileImporter.parse(
							fileResult.content,
							{ filename: fileResult.name },
						);

						let finalContent: string;
						let finalFileName = fileResult.name;

						if (parseResult.success) {
							finalContent = FileImporter.toJSON(
								parseResult.data,
								2,
							);
							if (
								parseResult.originalFormat !== "json" &&
								!fileResult.name.endsWith(".json")
							) {
								const baseName = fileResult.name.replace(
									/\.[^.]+$/,
									"",
								);
								finalFileName = `${baseName}.json`;
							}
						} else {
							finalContent = fileResult.content;
						}

						await tabs.add({
							title: finalFileName,
							content: finalContent,
							filePath: fileResult.path,
							isDirty:
								parseResult.success &&
								parseResult.originalFormat !== "json",
							isNew: false,
						});
						// Add to recent files
						await preferencesService.addRecentFile({
							path: fileResult.path,
							name: fileResult.name,
							type: fileResult.name.endsWith(".json")
								? "json"
								: "text",
						});

						if (
							parseResult.success &&
							parseResult.originalFormat !== "json"
						) {
							showNotification(
								"success",
								`Opened and converted ${fileResult.name} from ${parseResult.originalFormat.toUpperCase()} to JSON`,
							);
						}
					}
				} catch (error) {
					showNotification("error", `Failed to open file: ${error}`);
				}
				break;
			case "clear_recent_files":
				await preferencesService.clearRecentFiles();
				showNotification("info", "Recent files cleared");
				break;
			case "save_file":
				if ($currentTab) {
					try {
						if ($currentTab.filePath) {
							await fileOperations.saveFile(
								$currentTab.filePath,
								$currentTab.content,
							);
							await tabs.markSaved($currentTab.id);
							showNotification(
								"success",
								"File saved successfully",
							);
						} else {
							// No path yet, use save as
							const result = await fileOperations.saveFileAs(
								$currentTab.content,
								$currentTab.title,
							);
							if (result) {
								await tabs.updateTitle(
									$currentTab.id,
									result.name,
								);
								await tabs.markSaved(
									$currentTab.id,
									result.path,
								);
								showNotification(
									"success",
									`Saved as ${result.name}`,
								);
							}
						}
					} catch (error) {
						showNotification(
							"error",
							`Failed to save file: ${error}`,
						);
					}
				}
				break;
			case "save_as":
				if ($currentTab) {
					try {
						const result = await fileOperations.saveFileAs(
							$currentTab.content,
							$currentTab.title,
						);
						if (result) {
							await tabs.updateTitle($currentTab.id, result.name);
							await tabs.markSaved($currentTab.id, result.path);
							showNotification(
								"success",
								`Saved as ${result.name}`,
							);
						}
					} catch (error) {
						showNotification(
							"error",
							`Failed to save file: ${error}`,
						);
					}
				}
				break;
			case "close_tab":
				if ($currentTab) {
					await tabs.remove($currentTab.id);
				}
				break;

			// Edit menu
			case "undo":
				handleUndo();
				break;
			case "redo":
				handleRedo();
				break;
			case "find":
			case "find_replace":
				closeAllModals();
				showFindReplace = true;
				break;
			case "format_document":
				if (jsonEditor) {
					jsonEditor.format?.();
				}
				break;

			// View menu
			case "toggle_sidebar":
				// Emit event for sidebar toggle
				window.dispatchEvent(new CustomEvent("toggle-sidebar"));
				break;
			case "toggle_tree_view":
				handleViewModeChange({ mode: "tree" });
				break;
			case "toggle_code_view":
				handleViewModeChange({ mode: "code" });
				break;
			case "toggle_form_view":
				handleViewModeChange({ mode: "grid" });
				break;

			// Tools menu
			case "validate_json":
				showSchemaModal.set(true);
				break;
			case "repair_json":
				closeAllModals();
				showJSONRepair = true;
				break;
			case "compare_files":
				await handleOpenCompare();
				break;
			case "graph_visualizer":
				closeAllModals();
				showAdvancedVisualizer = true;
				break;

			// Help menu
			case "keyboard_shortcuts":
				closeAllModals();
				helpMode = "shortcuts";
				showHelp = true;
				break;
			case "view_modes_help":
				closeAllModals();
				helpMode = "viewmodes";
				showHelp = true;
				break;
			case "about":
				showNotification(
					"info",
					"Pandia v0.1.0 - A modern JSON editor built with Svelte and Tauri",
				);
				break;
			case "documentation":
				// Open documentation in browser
				open("https://www.pandia.app/docs");
				break;
		}
	}

	// Close all modals function
	function closeAllModals() {
		showImport = false;
		showVisualizer = false;
		showExport = false;
		showJSONRepair = false;
		showPathFinder = false;
		showImprovedQuery = false;
		showSnippetManager = false;
		showFindReplace = false;
		showBatchOperations = false;
		showAdvancedVisualizer = false;
		showTypeGenerator = false;
		showHelp = false;
		// Also close store-based modals
		showSchemaModal.set(false);
	}

	// Modal handlers
	function handleOpenImport() {
		closeAllModals();
		showImport = true;
	}

	async function handleImport(content: string, filename: string) {
		try {
			// Try to validate as JSON, but don't fail if it's not JSON
			try {
				JSON.parse(content);
			} catch (e) {
				// Content might be YAML, XML, etc. - that's fine
			}

			await tabs.add({
				title: filename,
				content: content,
				isDirty: false,
				isNew: false,
				viewMode: "tree", // Default to tree view for better UX
			});

			// Modal closes itself, we just handle the data
		} catch (error) {
			console.error("Import error:", error);
			// Modal will show error via onnotification
		}
	}

	async function handleOpenCompare() {
		closeAllModals();
		// Create a compare tab with the current tab's content as the left side
		await tabs.add({
			title: "Compare Files",
			content: "",
			isDirty: false,
			isNew: false,
			type: "compare",
			compareData: {
				leftContent: $currentTab?.content || "",
				leftTitle: $currentTab?.title || "Left File",
				rightContent: "",
				rightTitle: "Right File",
			},
		});
	}

	function handleOpenVisualizer() {
		const content = $currentTab?.content || "";
		const contentSize = new Blob([content]).size;

		if (contentSize > FILE_LIMITS.MAX_VISUALIZER_SIZE) {
			const sizeMB = (contentSize / BYTES.MB).toFixed(2);
			showNotification(
				"warning",
				`File too large (${sizeMB}MB) for Tree Visualizer. Use the main editor's Tree view instead.`,
			);
			return;
		}

		closeAllModals();
		showVisualizer = true;
	}

	function handleOpenExport() {
		closeAllModals();
		showExport = true;
	}

	function handleOpenJSONRepair() {
		closeAllModals();
		showJSONRepair = true;
	}

	function handleOpenPathFinder() {
		closeAllModals();
		showPathFinder = true;
	}

	function handleOpenQueryJSON() {
		closeAllModals();
		showImprovedQuery = true;
	}

	function handleOpenSnippetManager() {
		closeAllModals();
		showSnippetManager = true;
	}

	function handleOpenBatchOperations() {
		closeAllModals();
		showBatchOperations = true;
	}

	function handleOpenAdvancedVisualizer() {
		closeAllModals();
		showAdvancedVisualizer = true;
	}

	function handleOpenTypeGenerator() {
		closeAllModals();
		showTypeGenerator = true;
	}

	function handleQueryApply(event: {
		result: unknown;
		query: string;
		engine: QueryEngine;
	}) {
		const { result, query, engine } = event;
		const content = JSON.stringify(result, null, 2);
		if ($currentTab) {
			tabs.updateContent($currentTab.id, content);
		}
		showNotification(
			"success",
			`Applied query result from ${engine}: ${query.substring(0, 50)}${query.length > 50 ? "..." : ""}`,
		);
		closeAllModals();
	}

	function handleJSONRepairApply(event: { repairedJSON: string }) {
		const { repairedJSON } = event;
		if ($currentTab) {
			tabs.updateContent($currentTab.id, repairedJSON);
			showNotification(
				"success",
				"JSON has been repaired and applied successfully",
			);
		}
		closeAllModals();
	}

	// Find & Replace handlers
	function handleFind(term: string, options: FindOptions) {
		if (jsonEditor) {
			jsonEditor.findInEditor(term, options);
		}
	}

	function handleReplace(
		findTerm: string,
		replaceTerm: string,
		options: FindOptions,
	) {
		if (jsonEditor) {
			jsonEditor.replaceInEditor(findTerm, replaceTerm, options);
		}
	}

	function handleReplaceAll(
		findTerm: string,
		replaceTerm: string,
		options: FindOptions,
	) {
		if (jsonEditor) {
			jsonEditor.replaceAllInEditor(findTerm, replaceTerm, options);
		}
	}

	function handleViewModeChange(event: { mode: string }) {
		if (jsonEditor) {
			jsonEditor.setMode(event.mode);
		}
	}

	// Handle mode changes from the editor (e.g., when X button is clicked in grid view)
	function handleEditorModeChange(newMode: string, _oldMode: string) {
		// Sync the toolbar view mode with the editor mode
		if (toolbar) {
			toolbar.updateViewMode(newMode);
		}
	}

	// Notification system
	function showNotification(type: string, message: string, timeout = 3000) {
		// Deduplicate by type+message; if exists, refresh its timeout
		const existing = notifications.find(
			(n) => n.type === type && n.message === message,
		);
		if (existing) {
			// Move it to the end to show as most recent and refresh timeout
			notifications = [
				...notifications.filter((n) => n !== existing),
				existing,
			];
			if (existing.timeout && existing.timeout > 0) {
				setTimeout(
					() => dismissNotification(existing.id),
					existing.timeout,
				);
			}
			return;
		}

		// For errors, keep only one visible error at a time with the same message
		if (type === "error") {
			notifications = notifications.filter(
				(n) => !(n.type === "error" && n.message === message),
			);
		}

		const id = Date.now().toString();
		const notification = { id, type, message, timeout };
		notifications = [...notifications, notification];

		if (timeout > 0) {
			setTimeout(() => {
				dismissNotification(id);
			}, timeout);
		}
	}

	function dismissNotification(id: string) {
		notifications = notifications.filter((n) => n.id !== id);
	}

	// Enhanced editor event handlers
	function handleEditorError(event: { error: string }) {
		showNotification("error", event.error);
	}

	function handleEditorRepaired(_event: { content: string }) {
		showNotification("success", "JSON has been repaired successfully");
	}

	function handleValidationResult(event: ValidationResultEvent) {
		const { result, message } = event;
		showNotification(result.valid ? "success" : "warning", message);
	}

	function handleUndo() {
		if (jsonEditor) {
			jsonEditor.performUndo();
		}
	}

	function handleRedo() {
		if (jsonEditor) {
			jsonEditor.performRedo();
		}
	}

	// Prevent default browser behavior for drag/drop (browser would navigate to file)
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		event.stopPropagation();
	}

	function handleDrop(event: DragEvent) {
		// Always prevent default to stop browser from navigating to dropped file
		event.preventDefault();
		event.stopPropagation();
		// File handling is done via Tauri's onDragDropEvent in ImportModal
	}
</script>

<div
	class="app"
	ondragover={handleDragOver}
	ondrop={handleDrop}
	role="application"
>
	<Toolbar
		bind:this={toolbar}
		onopenCompare={handleOpenCompare}
		onopenVisualizer={handleOpenVisualizer}
		onopenExport={handleOpenExport}
		onopenJSONRepair={handleOpenJSONRepair}
		onopenPathFinder={handleOpenPathFinder}
		onopenSnippetManager={handleOpenSnippetManager}
		onopenBatchOperations={handleOpenBatchOperations}
		onviewModeChange={handleViewModeChange}
		onundo={handleUndo}
		onredo={handleRedo}
	/>
	<div class="main-content">
		<Sidebar
			openImport={handleOpenImport}
			openCompare={handleOpenCompare}
			openExport={handleOpenExport}
			openJSONRepair={handleOpenJSONRepair}
			openPathFinder={handleOpenPathFinder}
			openQueryJSON={handleOpenQueryJSON}
			openSnippetManager={handleOpenSnippetManager}
			openBatchOperations={handleOpenBatchOperations}
			openAdvancedVisualizer={handleOpenAdvancedVisualizer}
			openTypeGenerator={handleOpenTypeGenerator}
		/>
		<div class="editor-area">
			<TabManager />
			{#if $tabs.length === 0}
				<EmptyState />
			{:else if $currentTab?.type === "compare" && $currentTab.compareData}
				<CompareView
					tabId={$currentTab.id}
					compareData={$currentTab.compareData}
				/>
			{:else}
				<JSONEditor
					bind:this={jsonEditor}
					error={handleEditorError}
					repaired={handleEditorRepaired}
					validation={handleValidationResult}
					modeChange={handleEditorModeChange}
				/>
			{/if}
		</div>
	</div>

	<!-- Modals -->
	<ImportModal
		bind:isOpen={showImport}
		onImport={handleImport}
		onnotification={(e) => showNotification(e.type, e.message)}
	/>

	<JSONTreeVisualizer
		bind:visible={showVisualizer}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
	/>

	<ExportModal
		bind:visible={showExport}
		content={$currentTab?.content || ""}
		currentTabTitle={$currentTab?.title || ""}
		onclose={closeAllModals}
	/>

	<JSONRepairModal
		bind:visible={showJSONRepair}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
		onapply={handleJSONRepairApply}
	/>

	<PathFinderModal
		bind:visible={showPathFinder}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
		onpathSelected={(e) =>
			showNotification("info", `Selected path: ${e.path}`)}
		onnotification={(e) => showNotification(e.type, e.message)}
	/>

	<SnippetManagerModal
		bind:visible={showSnippetManager}
		onclose={closeAllModals}
		oninsertSnippet={(content: string) => {
			if ($currentTab) {
				tabs.updateContent($currentTab.id, content);
				showNotification("success", "Snippet inserted successfully");
			}
		}}
		onnotification={(e: NotificationEvent) =>
			showNotification(e.type, e.message)}
	/>

	<!-- New Feature Modals -->
	<FindReplaceModal
		bind:show={showFindReplace}
		onFind={handleFind}
		onReplace={handleReplace}
		onReplaceAll={handleReplaceAll}
	/>

	<SchemaModal show={$showSchemaModal} />

	<BatchOperationsModal
		bind:visible={showBatchOperations}
		onclose={closeAllModals}
	/>

	<GraphVisualizer
		bind:visible={showAdvancedVisualizer}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
	/>

	<JSONQueryModal
		bind:visible={showImprovedQuery}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
		onapply={handleQueryApply}
		onnotification={(e) => showNotification(e.type, e.message)}
	/>

	<TypeGeneratorModal
		bind:visible={showTypeGenerator}
		content={$currentTab?.content || ""}
		onclose={closeAllModals}
	/>

	<HelpModal bind:show={showHelp} mode={helpMode} onclose={closeAllModals} />

	<!-- Notification System -->
	{#if notifications.length > 0}
		<div class="notifications" role="region" aria-label="Notifications">
			{#each notifications as notification (notification.id)}
				<div
					class="notification notification-{notification.type}"
					role="alert"
				>
					<div class="notification-content">
						<span class="notification-message"
							>{notification.message}</span
						>
						<button
							class="notification-close"
							onclick={() => dismissNotification(notification.id)}
							aria-label="Dismiss notification"
						>
							×
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--color-background);
		color: var(--color-text);
		position: relative;
		font-family: var(--font-sans);
	}

	:global(.drag-over) {
		background: rgba(0, 122, 204, 0.1) !important;
		border: 2px dashed var(--color-primary) !important;
		border-radius: var(--border-radius-md);
	}

	.main-content {
		flex: 1;
		display: flex;
		overflow: hidden;
		gap: 0;
	}

	.editor-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-surface);
	}

	.notifications {
		position: fixed;
		top: var(--spacing-lg);
		right: var(--spacing-lg);
		z-index: 1100;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		max-width: 400px;
	}

	.notification {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		animation: slideInRight 0.3s ease;
		backdrop-filter: blur(8px);
	}

	.notification-success {
		border-left: 4px solid var(--color-success);
		background: rgba(40, 167, 69, 0.05);
	}

	.notification-error {
		border-left: 4px solid var(--color-error);
		background: rgba(220, 53, 69, 0.05);
	}

	.notification-warning {
		border-left: 4px solid var(--color-warning);
		background: rgba(255, 193, 7, 0.05);
	}

	.notification-info {
		border-left: 4px solid var(--color-info);
		background: rgba(23, 162, 184, 0.05);
	}

	.notification-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-md);
	}

	.notification-message {
		color: var(--color-text);
		font-size: var(--font-size-sm);
		flex: 1;
	}

	.notification-close {
		background: none;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: var(--font-size-lg);
		line-height: 1;
		padding: var(--spacing-xs);
		margin-left: var(--spacing-sm);
		border-radius: var(--border-radius-sm);
		transition: all 0.15s ease;
	}

	.notification-close:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	@keyframes slideInRight {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (max-width: 768px) {
		.notifications {
			top: var(--spacing-sm);
			right: var(--spacing-sm);
			left: var(--spacing-sm);
			max-width: none;
		}

		.main-content {
			flex-direction: column;
		}

		.editor-area {
			min-height: 300px;
		}
	}

	@media (prefers-contrast: high) {
		.notification {
			border: 2px solid var(--color-border);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.notification {
			animation: none;
		}
	}

	.app:focus-within {
		outline: none;
	}
</style>
