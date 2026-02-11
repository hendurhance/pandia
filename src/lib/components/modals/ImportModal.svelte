<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tabs } from '$lib/stores/tabs';
	import Icon from '../ui/Icon.svelte';
	import BaseModal from './BaseModal.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { FileImporter } from '$lib/services/import';
	import { readFromClipboard } from '$lib/utils/clipboard';
	import { formatError } from '$lib/utils/error';
	import { parseCurl, executeCurlRequest, formatParsedRequest, type ParsedCurlRequest } from '$lib/utils/curl-parser';
	import { fetchText } from '$lib/utils/http';
	import { fetchGistFile, parseGistUrl, type GistInfo } from '$lib/services/gist';
	import type { UnlistenFn } from '@tauri-apps/api/event';

	interface Props {
		isOpen?: boolean;
		onImport?: (content: string, filename: string) => void;
		onclose?: () => void;
		onnotification?: (event: { type: string; message: string }) => void;
	}

	let { isOpen = $bindable(false), onImport, onclose, onnotification }: Props = $props();

	let activeTab = $state('file'); // 'file' | 'url' | 'clipboard' | 'curl' | 'gist'
	let url = $state('');
	let clipboardContent = $state('');
	let curlCommand = $state('');
	let parsedCurl = $state<ParsedCurlRequest | null>(null);
	let curlParseError = $state('');
	let gistUrl = $state('');
	let gistPreview = $state<{ filename: string; owner?: string; description?: string } | null>(null);
	let gistError = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let fileInput: HTMLInputElement | null = $state(null);
	let isDragging = $state(false);
	let unlistenDrop: UnlistenFn | null = null;

	let isOpenRef = { current: false };
	let activeTabRef = { current: 'file' };

	$effect(() => {
		isOpenRef.current = isOpen;
	});

	$effect(() => {
		activeTabRef.current = activeTab;
	});

	onMount(async () => {
		try {
			const currentWindow = getCurrentWindow();

			unlistenDrop = await currentWindow.onDragDropEvent(async (event) => {
				if (!isOpenRef.current || activeTabRef.current !== 'file') return;
				
				if (event.payload.type === 'over') {
					isDragging = true;
				} else if (event.payload.type === 'leave') {
					isDragging = false;
				} else if (event.payload.type === 'drop') {
					isDragging = false;
					const paths = event.payload.paths;
					if (paths && paths.length > 0) {
						await processFilePath(paths[0]);
					}
				}
			});
		} catch (err) {
			console.error('Failed to setup drag-drop listener:', err);
		}
	});

	onDestroy(() => {
		if (unlistenDrop) {
			unlistenDrop();
		}
	});

	async function processFilePath(filePath: string) {
		isLoading = true;
		error = '';
		
		try {
			const content = await readTextFile(filePath);
			const filename = filePath.split('/').pop() || filePath.split('\\').pop() || 'file.json';
			await importContent(content, filename);
		} catch (err: any) {
			error = `Failed to read file: ${err.message || err}`;
			onnotification?.({ type: 'error', message: error });
		} finally {
			isLoading = false;
		}
	}

	function close() {
		isOpen = false;
		resetState();
		onclose?.();
	}

	function resetState() {
		url = '';
		clipboardContent = '';
		curlCommand = '';
		parsedCurl = null;
		curlParseError = '';
		gistUrl = '';
		gistPreview = null;
		gistError = '';
		error = '';
		isLoading = false;
		isDragging = false;
		activeTab = 'file';
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			await processFile(input.files[0]);
		}
		input.value = ''; // Reset input
	}

	async function processFile(file: File) {
		isLoading = true;
		error = '';

		try {
			const content = await file.text();
			await importContent(content, file.name);
		} catch (err: any) {
			error = `Failed to read file: ${err.message}`;
			onnotification?.({ type: 'error', message: error });
		} finally {
			isLoading = false;
		}
	}

	async function handleUrlFetch() {
		if (!url) return;

		isLoading = true;
		error = '';

		try {
			const data = await fetchText(url);
			const fileName = url.split('/').pop() || 'downloaded.json';

			await importContent(data, fileName);
		} catch (err: any) {
			error = `Failed to fetch URL: ${err.message}`;
			onnotification?.({ type: 'error', message: error });
		} finally {
			isLoading = false;
		}
	}

	async function handleClipboardImport() {
		if (!clipboardContent) return;
		const format = FileImporter.detectFormat(clipboardContent);
		const extension = format === 'unknown' ? 'json' : format === 'yaml' ? 'yaml' : format;
		await importContent(clipboardContent, `clipboard.${extension}`);
	}

	function handleCurlInput(value: string) {
		curlCommand = value;
		curlParseError = '';
		parsedCurl = null;

		if (!value.trim()) return;

		const result = parseCurl(value);
		if (result.success) {
			parsedCurl = result.request;
		} else {
			curlParseError = result.error;
		}
	}

	async function handleCurlExecute() {
		if (!parsedCurl) return;

		isLoading = true;
		error = '';

		try {
			const result = await executeCurlRequest(parsedCurl);

			if (!result.success) {
				error = result.error;
				onnotification?.({ type: 'error', message: result.error });
				return;
			}

			// Extract filename from URL
			const urlPath = new URL(parsedCurl.url).pathname;
			const urlFilename = urlPath.split('/').pop() || 'response';
			const filename = urlFilename.includes('.') ? urlFilename : `${urlFilename}.json`;

			await importContent(result.data, filename);
		} catch (err: any) {
			error = `Request failed: ${err.message || err}`;
			onnotification?.({ type: 'error', message: error });
		} finally {
			isLoading = false;
		}
	}

	function handleGistInput(value: string) {
		gistUrl = value;
		gistError = '';
		gistPreview = null;

		if (!value.trim()) return;

		const gistId = parseGistUrl(value);
		if (!gistId) {
			gistError = 'Invalid Gist URL or ID';
		}
	}

	async function handleGistFetch() {
		if (!gistUrl.trim()) return;

		isLoading = true;
		error = '';
		gistError = '';

		try {
			const result = await fetchGistFile(gistUrl);

			if (!result.success) {
				gistError = result.error;
				onnotification?.({ type: 'error', message: result.error });
				return;
			}

			const { content, filename, gist } = result.data;

			// Show preview info
			gistPreview = {
				filename,
				owner: gist.owner?.login,
				description: gist.description,
			};

			await importContent(content, filename);
		} catch (err: any) {
			gistError = `Failed to fetch gist: ${err.message || err}`;
			onnotification?.({ type: 'error', message: gistError });
		} finally {
			isLoading = false;
		}
	}

	async function importContent(content: string, filename: string) {
		isLoading = true;
		error = '';

		try {
			const result = await FileImporter.parse(content, { filename });

			let formattedContent: string;
			let finalFilename = filename;

			if (result.success) {
				formattedContent = FileImporter.toJSON(result.data, 2);

				if (result.originalFormat !== 'json' && !filename.endsWith('.json')) {
					const baseName = filename.replace(/\.[^.]+$/, '');
					finalFilename = `${baseName}.json`;
				}
			} else {
				try {
					const json = JSON.parse(content);
					formattedContent = JSON.stringify(json, null, 2);
				} catch {
					formattedContent = content;
					onnotification?.({
						type: 'warning',
						message: `Could not parse as ${result.format}: ${result.error.message}. Imported as raw text.`
					});
				}
			}

			if (onImport) {
				await Promise.resolve(onImport(formattedContent, finalFilename));
			} else {
				await tabs.add({
					title: finalFilename,
					content: formattedContent,
					isDirty: false,
					isNew: false
				});
			}

			const formatInfo = result.success && result.originalFormat !== 'json'
				? ` (converted from ${result.originalFormat.toUpperCase()})`
				: '';
			onnotification?.({ type: 'success', message: `Successfully imported ${finalFilename}${formatInfo}` });

			isOpen = false;
			resetState();
			onclose?.();
		} catch (err: unknown) {
			console.error('Import error:', err);
			error = `Failed to import: ${formatError(err)}`;
			onnotification?.({ type: 'error', message: error });
		} finally {
			isLoading = false;
		}
	}

	async function pasteFromClipboard() {
		const text = await readFromClipboard();
		if (text !== null) {
			clipboardContent = text;
		} else {
			error = 'Failed to read from clipboard. Please paste manually.';
		}
	}

	function triggerFileInput() {
		fileInput?.click();
	}
</script>

<BaseModal
	bind:visible={isOpen}
	title="Import Data"
	subtitle="Load JSON, YAML, XML, or CSV content"
	icon="import"
	width="md"
	onclose={close}
>
	<div class="modal-body">
				<div class="tabs-header">
					<button 
						class="tab-btn {activeTab === 'file' ? 'active' : ''}" 
						onclick={() => activeTab = 'file'}
					>
						<Icon name="file" size={16} /> File Upload
					</button>
					<button 
						class="tab-btn {activeTab === 'url' ? 'active' : ''}" 
						onclick={() => activeTab = 'url'}
					>
						<Icon name="link" size={16} /> From URL
					</button>
					<button
						class="tab-btn {activeTab === 'clipboard' ? 'active' : ''}"
						onclick={() => activeTab = 'clipboard'}
					>
						<Icon name="clipboard" size={16} /> Paste Text
					</button>
					<button
						class="tab-btn {activeTab === 'curl' ? 'active' : ''}"
						onclick={() => activeTab = 'curl'}
					>
						<Icon name="terminal" size={16} /> cURL
					</button>
					<button
						class="tab-btn {activeTab === 'gist' ? 'active' : ''}"
						onclick={() => activeTab = 'gist'}
					>
						<Icon name="github" size={16} /> Gist
					</button>
				</div>

				<div class="tab-content">
					{#if activeTab === 'file'}
						<div 
							class="drop-zone {isDragging ? 'dragging' : ''}"
							onclick={triggerFileInput}
							role="button"
							tabindex="0"
							onkeydown={(e) => e.key === 'Enter' && triggerFileInput()}
						>
							<input 
								type="file" 
								bind:this={fileInput} 
								onchange={handleFileSelect} 
								style="display: none;" 
								accept=".json,.txt,.csv,.xml,.yaml,.yml"
							/>
							<div class="drop-content">
								<div class="upload-icon">
									<Icon name="upload" size={32} />
								</div>
								<h3>Drag & Drop file here</h3>
								<p>or click to browse your computer</p>
								<div class="supported-formats">
									<span class="format-badge">JSON</span>
									<span class="format-badge">YAML</span>
									<span class="format-badge">XML</span>
									<span class="format-badge">CSV</span>
								</div>
							</div>
						</div>
					{:else if activeTab === 'url'}
						<div class="input-section">
							<label for="url-input">Enter Data URL</label>
							<div class="input-group">
								<div class="input-icon">
									<Icon name="link" size={16} />
								</div>
								<input
									id="url-input"
									type="text"
									bind:value={url}
									placeholder="https://api.example.com/data.json"
									onkeydown={(e) => e.key === 'Enter' && handleUrlFetch()}
									autocomplete="off"
									autocapitalize="off"
									spellcheck="false"
								/>
							</div>
							<p class="help-text">Enter a public URL to fetch data directly. We'll try to format it automatically.</p>
						</div>
					{:else if activeTab === 'clipboard'}
						<div class="input-section full-height">
							<div class="section-header">
								<label for="clipboard-input">Paste Content</label>
								<button class="btn-text" onclick={pasteFromClipboard}>
									<Icon name="clipboard" size={14} /> Paste from Clipboard
								</button>
							</div>
							<textarea
								id="clipboard-input"
								bind:value={clipboardContent}
								placeholder="Paste your JSON, YAML, or XML here..."
							></textarea>
						</div>
					{:else if activeTab === 'curl'}
						<div class="input-section curl-section">
							<label for="curl-input">Paste cURL Command</label>
							<textarea
								id="curl-input"
								value={curlCommand}
								oninput={(e) => handleCurlInput(e.currentTarget.value)}
								placeholder={`curl -X GET "https://api.example.com/data" \\
  -H "Authorization: Bearer token" \\
  -H "Content-Type: application/json"`}
								class="curl-input"
							></textarea>
							<p class="help-text">Paste a curl command from your browser dev tools, API docs, or terminal.</p>

							{#if curlParseError}
								<div class="parse-error">
									<Icon name="warning" size={14} />
									{curlParseError}
								</div>
							{/if}

							{#if parsedCurl}
								<div class="parsed-preview">
									<div class="preview-header">
										<Icon name="check" size={14} />
										<span>Parsed Request</span>
									</div>
									<div class="preview-content">
										<div class="preview-row">
											<span class="preview-label">Method</span>
											<span class="preview-value method-badge {parsedCurl.method.toLowerCase()}">{parsedCurl.method}</span>
										</div>
										<div class="preview-row">
											<span class="preview-label">URL</span>
											<span class="preview-value url">{parsedCurl.url}</span>
										</div>
										{#if Object.keys(parsedCurl.headers).length > 0}
											<div class="preview-row headers">
												<span class="preview-label">Headers</span>
												<div class="preview-value headers-list">
													{#each Object.entries(parsedCurl.headers) as [key, value]}
														<div class="header-item">
															<span class="header-key">{key}:</span>
															<span class="header-value">{key.toLowerCase() === 'authorization' ? '[hidden]' : value}</span>
														</div>
													{/each}
												</div>
											</div>
										{/if}
										{#if parsedCurl.body}
											<div class="preview-row">
												<span class="preview-label">Body</span>
												<span class="preview-value body">{parsedCurl.body.length > 100 ? parsedCurl.body.slice(0, 100) + '...' : parsedCurl.body}</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'gist'}
						<div class="input-section">
							<label for="gist-input">GitHub Gist URL or ID</label>
							<div class="input-group">
								<div class="input-icon">
									<Icon name="github" size={16} />
								</div>
								<input
									id="gist-input"
									type="text"
									value={gistUrl}
									oninput={(e) => handleGistInput(e.currentTarget.value)}
									placeholder="https://gist.github.com/username/gist_id"
									onkeydown={(e) => e.key === 'Enter' && !gistError && handleGistFetch()}
									autocomplete="off"
									autocapitalize="off"
									spellcheck="false"
								/>
							</div>
							<p class="help-text">Paste a GitHub Gist URL or ID. We'll fetch the first JSON file from the gist.</p>

							{#if gistError}
								<div class="parse-error">
									<Icon name="warning" size={14} />
									{gistError}
								</div>
							{/if}

							{#if gistPreview}
								<div class="gist-preview">
									<div class="preview-header">
										<Icon name="check" size={14} />
										<span>Gist Found</span>
									</div>
									<div class="preview-content">
										<div class="preview-row">
											<span class="preview-label">File</span>
											<span class="preview-value">{gistPreview.filename}</span>
										</div>
										{#if gistPreview.owner}
											<div class="preview-row">
												<span class="preview-label">Owner</span>
												<span class="preview-value">@{gistPreview.owner}</span>
											</div>
										{/if}
										{#if gistPreview.description}
											<div class="preview-row">
												<span class="preview-label">Desc</span>
												<span class="preview-value">{gistPreview.description}</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/if}

					{#if error}
						<div class="error-banner">
							<Icon name="warning" size={16} />
							{error}
						</div>
					{/if}

					{#if isLoading}
						<div class="loading-overlay">
							<div class="spinner"></div>
							<span>Processing...</span>
						</div>
					{/if}
				</div>
			</div>

	{#snippet footer()}
		<div class="footer-content">
			<button class="btn btn-secondary" onclick={close}>Cancel</button>
			{#if activeTab === 'url'}
				<button
					class="btn btn-primary"
					onclick={handleUrlFetch}
					disabled={!url || isLoading}
				>
					{#if isLoading}
						Loading...
					{:else}
						<Icon name="import" size={16} /> Fetch & Import
					{/if}
				</button>
			{:else if activeTab === 'clipboard'}
				<button
					class="btn btn-primary"
					onclick={handleClipboardImport}
					disabled={!clipboardContent || isLoading}
				>
					<Icon name="import" size={16} /> Import Text
				</button>
			{:else if activeTab === 'curl'}
				<button
					class="btn btn-primary"
					onclick={handleCurlExecute}
					disabled={!parsedCurl || isLoading}
				>
					{#if isLoading}
						Executing...
					{:else}
						<Icon name="terminal" size={16} /> Execute & Import
					{/if}
				</button>
			{:else if activeTab === 'gist'}
				<button
					class="btn btn-primary"
					onclick={handleGistFetch}
					disabled={!gistUrl || !!gistError || isLoading}
				>
					{#if isLoading}
						Fetching...
					{:else}
						<Icon name="github" size={16} /> Fetch & Import
					{/if}
				</button>
			{/if}
		</div>
	{/snippet}
</BaseModal>

<style>
	.modal-body {
		display: flex;
		flex-direction: column;
		min-height: 300px;
	}

	.tabs-header {
		display: flex;
		padding: 0 var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.tab-btn {
		padding: var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		font-weight: 500;
		transition: all 0.2s;
	}

	.tab-btn:hover {
		color: var(--color-text);
	}

	.tab-btn.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.tab-content {
		padding: var(--spacing-lg);
		flex: 1;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.drop-zone {
		border: 2px dashed var(--color-border-secondary);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-xl);
		text-align: center;
		cursor: pointer;
		transition: all 0.2s;
		background: var(--color-background-secondary);
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.drop-zone:hover, .drop-zone.dragging {
		border-color: var(--color-primary);
		background: rgba(var(--color-primary-rgb), 0.05);
	}

	.drop-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		color: var(--color-text-secondary);
		pointer-events: none;
	}

	.upload-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		margin-bottom: var(--spacing-sm);
	}

	.drop-content h3 {
		margin: 0;
		color: var(--color-text);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.supported-formats {
		display: flex;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-md);
	}

	.format-badge {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.input-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.input-section.full-height {
		flex: 1;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.btn-text {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		font-size: var(--font-size-xs);
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0;
	}

	.btn-text:hover {
		text-decoration: underline;
	}

	.input-section label {
		font-weight: 500;
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}

	.input-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.input-icon {
		position: absolute;
		left: var(--spacing-md);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.input-group input {
		width: 100%;
		padding: var(--spacing-md);
		padding-left: 40px;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		background: var(--color-background);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}

	.input-group input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
	}

	textarea {
		width: 100%;
		flex: 1;
		min-height: 200px;
		padding: var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		background: var(--color-background);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		resize: none;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.help-text {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.error-banner {
		margin-top: var(--spacing-md);
		padding: var(--spacing-sm) var(--spacing-md);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: var(--border-radius-sm);
		color: var(--color-error);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-md);
		color: white;
		border-radius: var(--border-radius-lg);
		backdrop-filter: blur(2px);
	}

	.spinner {
		width: 30px;
		height: 30px;
		border: 3px solid rgba(255, 255, 255, 0.3);
		border-radius: 50%;
		border-top-color: white;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.footer-content {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-md);
		width: 100%;
	}

	.btn {
		padding: var(--spacing-sm) var(--spacing-lg);
		border-radius: var(--border-radius-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid transparent;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
	}

	.btn-primary {
		background: var(--color-primary);
		color: white;
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.curl-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		flex: 1;
	}

	.curl-input {
		width: 100%;
		min-height: 100px;
		padding: var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		background: var(--color-background);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		resize: vertical;
		line-height: 1.5;
	}

	.curl-input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
	}

	.parse-error {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: var(--border-radius-sm);
		color: var(--color-error);
		font-size: var(--font-size-sm);
	}

	.parsed-preview {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		background: var(--color-surface);
		overflow: hidden;
	}

	.preview-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: rgba(34, 197, 94, 0.1);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-success);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}

	.preview-content {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.preview-row {
		display: flex;
		gap: var(--spacing-md);
		align-items: flex-start;
	}

	.preview-row.headers {
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.preview-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		min-width: 60px;
		flex-shrink: 0;
	}

	.preview-value {
		font-size: var(--font-size-sm);
		color: var(--color-text);
		word-break: break-all;
	}

	.preview-value.url {
		font-family: var(--font-mono);
		color: var(--color-primary);
	}

	.preview-value.body {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		background: var(--color-background);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--border-radius-sm);
		border: 1px solid var(--color-border);
	}

	.method-badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 600;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
	}

	.method-badge.get {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.method-badge.post {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.method-badge.put {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.method-badge.patch {
		background: rgba(168, 85, 247, 0.15);
		color: #a855f7;
	}

	.method-badge.delete {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.headers-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
	}

	.header-item {
		display: flex;
		gap: var(--spacing-xs);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		padding: 2px var(--spacing-sm);
		background: var(--color-background);
		border-radius: var(--border-radius-sm);
	}

	.header-key {
		color: var(--color-text-secondary);
	}

	.header-value {
		color: var(--color-text);
		word-break: break-all;
	}

	.gist-preview {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		background: var(--color-surface);
		overflow: hidden;
		margin-top: var(--spacing-sm);
	}
</style>
