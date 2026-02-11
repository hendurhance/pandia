<script lang="ts">
	import { BYTES } from "$lib/constants";
	import { fileOperations } from "$lib/services/file";
	import { jsonUtils } from "$lib/services/json";
	import { tabs } from "$lib/stores/tabs";
	import Icon from "../ui/Icon.svelte";

	interface Props {
		visible?: boolean;
		onclose?: () => void;
	}

	let { visible = $bindable(false), onclose }: Props = $props();

	export type BatchOperationId =
		| "validate"
		| "format"
		| "compress"
		| "repair"
		| "open-tabs";

	export type Operation = {
		id: BatchOperationId;
		name: string;
		icon: string;
		description: string;
	};

	let activeOperationId: BatchOperationId = $state("validate");
	let selectedFiles: { path: string; name: string; content: string }[] =
		$state([]);
	let isProcessing = $state(false);
	let progressPercent = $state(0);
	let results: any = $state(null);
	let logs: {
		time: string;
		message: string;
		type: "info" | "error" | "success";
	}[] = $state([]);
	let activeTab = $state("files"); // 'files', 'results', 'logs'

	const operations: Operation[] = [
		{
			id: "validate",
			name: "Validate JSON",
			icon: "check-circle",
			description:
				"Check if files contain valid JSON syntax and structure.",
		},
		{
			id: "format",
			name: "Format JSON",
			icon: "format",
			description:
				"Format JSON files with proper indentation (2 spaces).",
		},
		{
			id: "compress",
			name: "Minify JSON",
			icon: "compress",
			description: "Remove unnecessary whitespace to reduce file size.",
		},
		{
			id: "repair",
			name: "Repair JSON",
			icon: "repair",
			description:
				"Attempt to fix common JSON syntax errors automatically.",
		},
		{
			id: "open-tabs",
			name: "Open as Tabs",
			icon: "file-code",
			description: "Open multiple files as editor tabs at once.",
		},
	];

	const activeOperation = $derived(
		operations.find((op) => op.id === activeOperationId) || operations[0],
	);

	async function selectFiles() {
		try {
			const fileResults = await fileOperations.openMultipleFiles();
			// Avoid duplicates
			const newFiles = fileResults.filter(
				(f) => !selectedFiles.some((sf) => sf.path === f.path),
			);

			selectedFiles = [...selectedFiles, ...newFiles];

			if (newFiles.length > 0) {
				addLog(`Added ${newFiles.length} files to the list`, "info");
			}

			if (selectedFiles.length > 0 && activeTab !== "files") {
				activeTab = "files";
			}
		} catch (error: any) {
			addLog(`Error selecting files: ${error.message}`, "error");
		}
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	async function processFiles() {
		if (selectedFiles.length === 0) {
			addLog("No files selected", "error");
			return;
		}

		isProcessing = true;
		progressPercent = 0;
		results = null;
		logs = []; // Clear previous logs for new run
		activeTab = "logs";

		addLog(
			`Starting ${activeOperation.name} on ${selectedFiles.length} files...`,
			"info",
		);

		try {
			if (activeOperationId === "open-tabs") {
				await openFilesAsTabs();
			} else {
				await performBatchOperation();
			}
			activeTab = "results";
		} catch (error: any) {
			addLog(`Operation failed: ${error.message}`, "error");
		} finally {
			isProcessing = false;
			progressPercent = 100;
		}
	}

	async function openFilesAsTabs() {
		let opened = 0;
		const total = selectedFiles.length;

		for (const file of selectedFiles) {
			await tabs.add({
				title: file.name,
				content: file.content,
				filePath: file.path,
				isDirty: false,
				isNew: false,
			});
			opened++;
			progressPercent = (opened / total) * 100;
			addLog(`Opened: ${file.name}`, "success");
		}

		results = {
			success: opened,
			total,
			errors: 0,
			type: "open-tabs",
		};
	}

	async function performBatchOperation() {
		const contents = selectedFiles.map((f) => f.content);

		progressPercent = 10;
		addLog(`Processing ${contents.length} files...`, "info");

		let batchResults;

		switch (activeOperationId) {
			case "validate":
				batchResults = await jsonUtils.batchValidate(contents);
				break;
			case "format":
				batchResults = await jsonUtils.batchFormat(contents, 2);
				break;
			case "compress":
				batchResults = await jsonUtils.batchCompress(contents);
				break;
			case "repair":
				batchResults = await jsonUtils.batchRepairJson(contents);
				break;
			default:
				throw new Error("Unknown operation");
		}

		progressPercent = 60;

		// For operations that modify content, save back to files
		if (["format", "compress", "repair"].includes(activeOperationId)) {
			const filesToSave: { path: string; content: string }[] = [];

			for (let i = 0; i < selectedFiles.length; i++) {
				if (
					batchResults.results[i] &&
					batchResults.errors[i] === null
				) {
					filesToSave.push({
						path: selectedFiles[i].path,
						content: String(batchResults.results[i]),
					});
				}
			}

			if (filesToSave.length > 0) {
				addLog(
					`Saving ${filesToSave.length} modified files...`,
					"info",
				);
				const saveResults =
					await fileOperations.saveBatchFiles(filesToSave);

				if (saveResults.errors.length > 0) {
					saveResults.errors.forEach((error) =>
						addLog(
							`Failed to save ${error.path}: ${error.error}`,
							"error",
						),
					);
				} else {
					addLog(
						`Successfully saved ${saveResults.success.length} files`,
						"success",
					);
				}
			}
		}

		progressPercent = 90;

		// Process results for display
		const successCount = batchResults.results.filter(
			(r, i) => batchResults.errors[i] === null,
		).length;
		const errorCount = batchResults.errors.filter((e) => e !== null).length;

		// Log individual errors
		batchResults.errors.forEach((error, i) => {
			if (error) {
				addLog(`${selectedFiles[i].name}: ${error}`, "error");
			} else {
				// Only log success if it's not too spammy (e.g. < 20 files)
				if (selectedFiles.length < 20) {
					addLog(`${selectedFiles[i].name}: Success`, "success");
				}
			}
		});

		results = {
			total: selectedFiles.length,
			success: successCount,
			errors: errorCount,
			details: batchResults,
			type: activeOperationId,
		};

		addLog(
			`Completed: ${successCount} success, ${errorCount} errors`,
			successCount === selectedFiles.length ? "success" : "info",
		);
	}

	function addLog(
		message: string,
		type: "info" | "error" | "success" = "info",
	) {
		logs = [
			...logs,
			{
				time: new Date().toLocaleTimeString(),
				message,
				type,
			},
		];
	}

	function close() {
		visible = false;
		onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && visible) {
			close();
		}
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			close();
		}
	}

	function clearFiles() {
		selectedFiles = [];
		results = null;
		logs = [];
		progressPercent = 0;
		activeTab = "files";
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
	<div
		class="modal-overlay"
		onclick={handleOverlayClick}
		onkeydown={(e) => e.key === "Escape" && close()}
		role="dialog"
		aria-modal="true"
		aria-label="Batch Operations"
		tabindex="-1"
	>
		<section class="modal-container" aria-label="Batch Operations Dialog">
			<!-- Sidebar -->
			<div class="sidebar">
				<div class="sidebar-header">
					<h2>Batch Operations</h2>
				</div>
				<div class="nav-list">
					{#each operations as op}
						<button
							class="nav-item {activeOperationId === op.id
								? 'active'
								: ''}"
							onclick={() => {
								activeOperationId = op.id;
								results = null;
								activeTab = "files";
							}}
							disabled={isProcessing}
						>
							<Icon name={op.icon} size={16} />
							<span>{op.name}</span>
						</button>
					{/each}
				</div>
				<div class="sidebar-footer">
					<div class="file-count">
						<Icon name="file" size={14} />
						<span>{selectedFiles.length} files selected</span>
					</div>
				</div>
			</div>

			<!-- Main Content -->
			<div class="main-content">
				<div class="content-header">
					<div class="header-info">
						<h3>{activeOperation.name}</h3>
						<p>{activeOperation.description}</p>
					</div>
					<button class="btn-icon" onclick={close} title="Close">
						<Icon name="close" size={20} />
					</button>
				</div>

				<div class="content-body">
					<!-- Tabs -->
					<div class="tabs">
						<button
							class="tab {activeTab === 'files' ? 'active' : ''}"
							onclick={() => (activeTab = "files")}
						>
							Files ({selectedFiles.length})
						</button>
						{#if results || isProcessing}
							<button
								class="tab {activeTab === 'results'
									? 'active'
									: ''}"
								onclick={() => (activeTab = "results")}
							>
								Results
							</button>
						{/if}
						<button
							class="tab {activeTab === 'logs' ? 'active' : ''}"
							onclick={() => (activeTab = "logs")}
						>
							Logs
						</button>
					</div>

					<div class="tab-content">
						{#if activeTab === "files"}
							<div class="files-view">
								<div class="toolbar">
									<button
										class="btn-primary"
										onclick={selectFiles}
										disabled={isProcessing}
									>
										<Icon name="plus" size={14} /> Add Files
									</button>
									{#if selectedFiles.length > 0}
										<button
											class="btn-secondary"
											onclick={clearFiles}
											disabled={isProcessing}
										>
											<Icon name="trash" size={14} /> Clear
											All
										</button>
									{/if}
								</div>

								{#if selectedFiles.length === 0}
									<div class="empty-state">
										<Icon name="folder-open" size={48} />
										<p>No files selected</p>
										<button
											class="btn-link"
											onclick={selectFiles}
											>Browse files...</button
										>
									</div>
								{:else}
									<div class="file-list">
										{#each selectedFiles as file, i}
											<div class="file-item">
												<div class="file-info">
													<Icon
														name="file-code"
														size={16}
													/>
													<span
														class="file-name"
														title={file.path}
														>{file.name}</span
													>
													<span class="file-size"
														>{(
															file.content
																.length /
															BYTES.KB
														).toFixed(1)} KB</span
													>
												</div>
												<button
													class="btn-icon-sm"
													onclick={() =>
														removeFile(i)}
													disabled={isProcessing}
													title="Remove file"
												>
													<Icon
														name="close"
														size={14}
													/>
												</button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{:else if activeTab === "results"}
							<div class="results-view">
								{#if isProcessing}
									<div class="processing-state">
										<div class="spinner"></div>
										<p>
											Processing files... {Math.round(
												progressPercent,
											)}%
										</p>
										<div class="progress-bar">
											<div
												class="progress-fill"
												style="width: {progressPercent}%"
											></div>
										</div>
									</div>
								{:else if results}
									<div class="results-summary">
										<div class="stat-card success">
											<div class="stat-value">
												{results.success}
											</div>
											<div class="stat-label">
												Successful
											</div>
										</div>
										<div class="stat-card error">
											<div class="stat-value">
												{results.errors}
											</div>
											<div class="stat-label">Failed</div>
										</div>
										<div class="stat-card total">
											<div class="stat-value">
												{results.total}
											</div>
											<div class="stat-label">
												Total Files
											</div>
										</div>
									</div>

									{#if results.errors > 0}
										<div class="error-list">
											<h4>Failures</h4>
											{#each results.details.errors as error, i}
												{#if error}
													<div class="error-item">
														<span class="error-file"
															>{selectedFiles[i]
																.name}</span
														>
														<span class="error-msg"
															>{error}</span
														>
													</div>
												{/if}
											{/each}
										</div>
									{/if}
								{/if}
							</div>
						{:else if activeTab === "logs"}
							<div class="logs-view">
								{#each logs as log}
									<div class="log-entry {log.type}">
										<span class="log-time">{log.time}</span>
										<span class="log-msg"
											>{log.message}</span
										>
									</div>
								{/each}
								{#if logs.length === 0}
									<div class="empty-logs">
										No activity logs yet
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<div class="content-footer">
					<div class="footer-status">
						{#if isProcessing}
							<span class="status-processing">Processing...</span>
						{:else if results}
							<span class="status-done">Done</span>
						{/if}
					</div>
					<div class="footer-actions">
						<button class="btn-secondary" onclick={close}
							>Cancel</button
						>
						<button
							class="btn-primary"
							onclick={processFiles}
							disabled={isProcessing ||
								selectedFiles.length === 0}
						>
							{#if isProcessing}
								Processing...
							{:else}
								Run {activeOperation.name}
							{/if}
						</button>
					</div>
				</div>
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
		background: rgba(0, 0, 0, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
		backdrop-filter: blur(4px);
	}

	.modal-container {
		display: flex;
		width: 900px;
		height: 600px;
		background: var(--color-surface);
		border-radius: 12px;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border);
		overflow: hidden;
	}

	.sidebar {
		width: 240px;
		background: var(--color-background-secondary);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
	}

	.sidebar-header {
		padding: 20px;
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar-header h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text);
	}

	.nav-list {
		flex: 1;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
		font-size: 13px;
		text-align: left;
		transition: all 0.2s;
	}

	.nav-item:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.nav-item.active {
		background: var(--color-primary);
		color: #fff;
	}

	.nav-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sidebar-footer {
		padding: 16px;
		border-top: 1px solid var(--color-border);
		background: var(--color-background-secondary);
	}

	.file-count {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-text-muted);
		font-size: 12px;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
	}

	.content-header {
		padding: 20px 24px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.header-info h3 {
		margin: 0 0 4px 0;
		font-size: 18px;
		color: var(--color-text);
	}

	.header-info p {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.content-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.tabs {
		display: flex;
		padding: 0 24px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-background-secondary);
	}

	.tab {
		padding: 12px 16px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab:hover {
		color: var(--color-text);
	}

	.tab.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}

	.files-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 16px;
	}

	.toolbar {
		display: flex;
		gap: 10px;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border: 2px dashed var(--color-border);
		border-radius: 8px;
		color: var(--color-text-muted);
		gap: 12px;
	}

	.empty-state p {
		margin: 0;
		font-size: 14px;
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		text-decoration: underline;
		font-size: 14px;
	}

	.file-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.file-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		background: var(--color-background-secondary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}

	.file-info {
		display: flex;
		align-items: center;
		gap: 10px;
		overflow: hidden;
	}

	.file-name {
		font-size: 13px;
		color: var(--color-text);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 300px;
	}

	.file-size {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	/* Results View */
	.results-view {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.processing-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px;
		gap: 16px;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.progress-bar {
		width: 200px;
		height: 6px;
		background: var(--color-border);
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-primary);
		transition: width 0.3s ease;
	}

	.results-summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}

	.stat-card {
		padding: 16px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		text-align: center;
	}

	.stat-card.success {
		background: rgba(40, 167, 69, 0.1);
		border-color: rgba(40, 167, 69, 0.2);
	}
	.stat-card.error {
		background: rgba(220, 53, 69, 0.1);
		border-color: rgba(220, 53, 69, 0.2);
	}
	.stat-card.total {
		background: var(--color-background-secondary);
	}

	.stat-value {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 4px;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 12px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.error-list h4 {
		margin: 0 0 12px 0;
		font-size: 14px;
		color: var(--color-text);
	}

	.error-item {
		padding: 10px;
		background: rgba(220, 53, 69, 0.05);
		border-left: 3px solid var(--color-error);
		margin-bottom: 8px;
		font-size: 13px;
	}

	.error-file {
		font-weight: 600;
		color: var(--color-text);
		margin-right: 8px;
	}

	.error-msg {
		color: var(--color-error);
	}

	.logs-view {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.log-entry {
		padding: 6px 10px;
		border-radius: 4px;
		display: flex;
		gap: 10px;
	}

	.log-entry.info {
		color: var(--color-text-secondary);
	}
	.log-entry.success {
		color: var(--color-success);
		background: rgba(40, 167, 69, 0.05);
	}
	.log-entry.error {
		color: var(--color-error);
		background: rgba(220, 53, 69, 0.05);
	}

	.log-time {
		color: var(--color-text-muted);
		min-width: 60px;
	}

	.empty-logs {
		text-align: center;
		color: var(--color-text-muted);
		padding: 20px;
		font-style: italic;
	}

	.content-footer {
		padding: 16px 24px;
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-surface);
	}

	.footer-actions {
		display: flex;
		gap: 10px;
	}

	.status-processing {
		color: var(--color-primary);
		font-size: 13px;
	}
	.status-done {
		color: var(--color-success);
		font-size: 13px;
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.2s;
	}

	.btn-primary {
		background: var(--color-primary);
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--color-surface-secondary);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.btn-icon {
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
	}

	.btn-icon:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.btn-icon-sm {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-icon-sm:hover {
		color: var(--color-error);
		background: rgba(220, 53, 69, 0.1);
	}
</style>
