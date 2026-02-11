<script lang="ts">
	import { jsonUtils } from '$lib/services/json';
	import { fileOperations } from '$lib/services/file';
	import { copyToClipboard as copyText } from '$lib/utils/clipboard';
	import { sendToWebhook, detectWebhookType, validateWebhookUrl } from '$lib/services/webhook';
	import { createAnonymousGist, type GistInfo } from '$lib/services/gist';
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		visible?: boolean;
		content?: string;
		currentTabTitle?: string;
		onclose?: () => void;
		onnotification?: (event: { type: string; message: string }) => void;
	}

	let { visible = $bindable(false), content = '', currentTabTitle = '', onclose, onnotification }: Props = $props();

	let exportFormat: 'json' | 'yaml' | 'xml' | 'csv' | 'base64' | 'url' | 'minified' = $state('json');
	let exportDestination: 'file' | 'webhook' | 'gist' = $state('file');
	let isExporting = $state(false);
	let exportResult = $state('');
	let error = $state('');

	let webhookUrl = $state('');
	let webhookError = $state('');
	let webhookSuccess = $state(false);

	let gistDescription = $state('');
	let gistIsPublic = $state(true);
	let gistResult = $state<GistInfo | null>(null);

	const formats = [
		{ id: 'json', label: 'Pretty JSON', icon: 'code', desc: 'Standard formatted JSON' },
		{ id: 'minified', label: 'Minified JSON', icon: 'minimize', desc: 'Compact single-line JSON' },
		{ id: 'yaml', label: 'YAML', icon: 'file', desc: 'YAML Ain\'t Markup Language' },
		{ id: 'xml', label: 'XML', icon: 'code', desc: 'Extensible Markup Language' },
		{ id: 'csv', label: 'CSV', icon: 'table', desc: 'Comma Separated Values' },
		{ id: 'base64', label: 'Base64', icon: 'lock', desc: 'Base64 Encoded String' },
		{ id: 'url', label: 'URL Encoded', icon: 'link', desc: 'URL Safe String' }
	];

	async function performExport() {
		if (!content) return;
		
		isExporting = true;
		error = '';
		exportResult = '';
		
		try {
			let result: string;
			
			switch (exportFormat) {
				case 'json':
					result = await jsonUtils.format(content, 2);
					break;
					
				case 'minified':
					result = await jsonUtils.compress(content);
					break;
					
				case 'yaml':
					result = await jsonUtils.convertToYaml(content);
					break;
					
				case 'xml':
					result = await jsonUtils.convertToXml(content);
					break;
					
				case 'csv':
					result = await jsonUtils.convertToCsv(content);
					break;
					
				case 'base64':
					result = btoa(content);
					break;
					
				case 'url':
					result = encodeURIComponent(content);
					break;
					
				default:
					throw new Error('Unknown export format');
			}
			
			exportResult = result;
		} catch (err: any) {
			error = err.message || 'Export failed';
		} finally {
			isExporting = false;
		}
	}
	
	async function copyToClipboard() {
		if (exportResult) {
			const success = await copyText(exportResult);
			if (success) {
				onnotification?.({ type: 'success', message: 'Copied to clipboard' });
			} else {
				onnotification?.({ type: 'error', message: 'Failed to copy to clipboard' });
			}
		}
	}
	
	async function saveToFile() {
		if (!exportResult) return;
		
		try {
			const extension = getFileExtension(exportFormat);
			
			// Generate default filename based on current tab
			let defaultFileName = 'untitled';
			if (currentTabTitle) {
				// Remove existing extension and use the base name
				defaultFileName = currentTabTitle.replace(/\.[^/.]+$/, '');
			}
			defaultFileName = `${defaultFileName}.${extension}`;
			
			const result = await fileOperations.saveFileAs(exportResult, defaultFileName);
			if (result) {
				console.log('File saved:', result.path);
				onnotification?.({ type: 'success', message: `File saved to ${result.path}` });
			}
		} catch (error) {
			console.error('Error saving file:', error);
			onnotification?.({ type: 'error', message: `Failed to save file: ${error}` });
		}
	}
	
	function getFileExtension(format: string): string {
		switch (format) {
			case 'json':
			case 'minified':
				return 'json';
			case 'yaml':
				return 'yaml';
			case 'xml':
				return 'xml';
			case 'csv':
				return 'csv';
			case 'base64':
				return 'txt';
			case 'url':
				return 'txt';
			default:
				return 'txt';
		}
	}

	function handleWebhookInput(value: string) {
		webhookUrl = value;
		webhookError = '';
		webhookSuccess = false;

		if (value.trim()) {
			const validation = validateWebhookUrl(value);
			if (!validation.valid) {
				webhookError = validation.error || 'Invalid URL';
			}
		}
	}

	async function sendToWebhookHandler() {
		if (!exportResult || !webhookUrl) return;

		isExporting = true;
		webhookError = '';
		webhookSuccess = false;

		try {
			const filename = currentTabTitle || 'data.json';
			const result = await sendToWebhook(exportResult, { url: webhookUrl }, filename);

			if (!result.success) {
				webhookError = result.error;
				onnotification?.({ type: 'error', message: result.error });
				return;
			}

			webhookSuccess = true;
			onnotification?.({ type: 'success', message: 'Successfully sent to webhook!' });
		} catch (err: any) {
			webhookError = err.message || 'Failed to send';
			onnotification?.({ type: 'error', message: webhookError });
		} finally {
			isExporting = false;
		}
	}

	async function createGistHandler() {
		if (!exportResult) return;

		isExporting = true;
		error = '';

		try {
			const filename = currentTabTitle?.replace(/\.[^/.]+$/, '') + '.' + getFileExtension(exportFormat) || 'data.json';
			const result = await createAnonymousGist(
				exportResult,
				filename,
				gistDescription,
				gistIsPublic
			);

			if (!result.success) {
				error = result.error;
				onnotification?.({ type: 'error', message: result.error });
				return;
			}

			gistResult = result.data;
			onnotification?.({ type: 'success', message: 'Gist created successfully!' });
		} catch (err: any) {
			error = err.message || 'Failed to create gist';
			onnotification?.({ type: 'error', message: error });
		} finally {
			isExporting = false;
		}
	}

	function copyGistUrl() {
		if (gistResult?.html_url) {
			navigator.clipboard.writeText(gistResult.html_url);
			onnotification?.({ type: 'success', message: 'Gist URL copied!' });
		}
	}

	function openGist() {
		if (gistResult?.html_url) {
			window.open(gistResult.html_url, '_blank');
		}
	}

	function resetState() {
		webhookUrl = '';
		webhookError = '';
		webhookSuccess = false;
		gistDescription = '';
		gistIsPublic = true;
		gistResult = null;
		error = '';
	}

	$effect(() => {
		if (visible && content && exportFormat) {
			performExport();
		}
	});

	$effect(() => {
		if (exportDestination) {
			resetState();
		}
	});
</script>

<BaseModal
	bind:visible
	title="Export Data"
	subtitle="Convert and save your data in different formats"
	icon="export"
	width="lg"
	{onclose}
>
	<div class="modal-body">
		<div class="export-config">
			<span class="section-label">Select Format</span>
			<div class="format-grid">
				{#each formats as format}
					<button
						class="format-card {exportFormat === format.id ? 'active' : ''}"
						onclick={() => exportFormat = format.id as any}
					>
						<div class="format-icon">
							<Icon name={format.icon} size={20} />
						</div>
						<div class="format-info">
							<span class="format-name">{format.label}</span>
							<span class="format-desc">{format.desc}</span>
						</div>
						{#if exportFormat === format.id}
							<div class="check-icon">
								<Icon name="success" size={16} />
							</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="export-config">
			<span class="section-label">Export To</span>
			<div class="destination-tabs">
				<button
					class="dest-tab {exportDestination === 'file' ? 'active' : ''}"
					onclick={() => exportDestination = 'file'}
				>
					<Icon name="file-save" size={16} /> File
				</button>
				<button
					class="dest-tab {exportDestination === 'webhook' ? 'active' : ''}"
					onclick={() => exportDestination = 'webhook'}
				>
					<Icon name="send" size={16} /> Webhook
				</button>
				<button
					class="dest-tab {exportDestination === 'gist' ? 'active' : ''}"
					onclick={() => exportDestination = 'gist'}
				>
					<Icon name="github" size={16} /> GitHub Gist
				</button>
			</div>
		</div>

		{#if exportDestination === 'webhook'}
			<div class="destination-config">
				<label for="webhook-url">Webhook URL</label>
				<div class="input-group">
					<div class="input-icon">
						<Icon name="link" size={16} />
					</div>
					<input
						id="webhook-url"
						type="text"
						value={webhookUrl}
						oninput={(e) => handleWebhookInput(e.currentTarget.value)}
						placeholder="https://hooks.slack.com/services/..."
						autocomplete="off"
					/>
				</div>
				<p class="help-text">Supports Slack, Discord, Zapier, and custom webhooks.</p>

				{#if webhookError}
					<div class="inline-error">
						<Icon name="warning" size={14} />
						{webhookError}
					</div>
				{/if}

				{#if webhookSuccess}
					<div class="inline-success">
						<Icon name="check" size={14} />
						Successfully sent to webhook!
					</div>
				{/if}

				{#if webhookUrl && !webhookError}
					{@const preset = detectWebhookType(webhookUrl)}
					<div class="webhook-preview">
						<Icon name={preset.icon} size={14} />
						<span>Detected: {preset.name}</span>
					</div>
				{/if}
			</div>
		{:else if exportDestination === 'gist'}
			<div class="destination-config">
				<label for="gist-desc">Description (optional)</label>
				<input
					id="gist-desc"
					type="text"
					bind:value={gistDescription}
					placeholder="My JSON data"
					class="text-input"
				/>

				<div class="gist-options">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={gistIsPublic} />
						<span>Public Gist</span>
					</label>
					<p class="help-text">Public gists are visible to everyone. Private gists are only accessible via URL.</p>
				</div>

				{#if gistResult}
					<div class="gist-result">
						<div class="gist-result-header">
							<Icon name="check" size={16} />
							<span>Gist Created!</span>
						</div>
						<div class="gist-url">
							<code>{gistResult.html_url}</code>
							<div class="gist-actions">
								<button class="btn-icon" onclick={copyGistUrl} title="Copy URL">
									<Icon name="clipboard" size={14} />
								</button>
								<button class="btn-icon" onclick={openGist} title="Open in browser">
									<Icon name="link" size={14} />
								</button>
							</div>
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

		{#if isExporting}
			<div class="loading-state">
				<div class="spinner"></div>
				<span>Processing export...</span>
			</div>
		{:else if exportResult}
			<div class="result-section">
				<div class="result-header">
					<h3>Preview</h3>
					<div class="result-stats">
						{exportResult.length} characters
						{#if exportFormat === 'base64'}
							| {Math.round(exportResult.length * 0.75)} bytes original
						{/if}
					</div>
				</div>
				<div class="result-container">
					<CodeBlock
						code={exportResult}
						language={exportFormat === 'yaml' ? 'yaml' : exportFormat === 'xml' ? 'xml' : 'json'}
						showLineNumbers={false}
						maxHeight="200px"
					/>
				</div>
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<div class="footer-content">
			<button class="btn btn-secondary" onclick={onclose}>Cancel</button>
			<div class="action-buttons">
				<button
					class="btn btn-secondary"
					onclick={copyToClipboard}
					disabled={!exportResult}
				>
					<Icon name="clipboard" size={16} />
					Copy
				</button>

				{#if exportDestination === 'file'}
					<button
						class="btn btn-primary"
						onclick={saveToFile}
						disabled={!exportResult}
					>
						<Icon name="file-save" size={16} />
						Save as File
					</button>
				{:else if exportDestination === 'webhook'}
					<button
						class="btn btn-primary"
						onclick={sendToWebhookHandler}
						disabled={!exportResult || !webhookUrl || !!webhookError || isExporting}
					>
						{#if isExporting}
							Sending...
						{:else}
							<Icon name="send" size={16} />
							Send to Webhook
						{/if}
					</button>
				{:else if exportDestination === 'gist'}
					<button
						class="btn btn-primary"
						onclick={createGistHandler}
						disabled={!exportResult || isExporting || !!gistResult}
					>
						{#if isExporting}
							Creating...
						{:else if gistResult}
							<Icon name="check" size={16} />
							Created!
						{:else}
							<Icon name="github" size={16} />
							Create Gist
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/snippet}
</BaseModal>

<style>
	.modal-body {
		padding: var(--spacing-lg);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-lg);
	}

	.section-label {
		display: block;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		font-weight: 500;
		margin-bottom: var(--spacing-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.format-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--spacing-md);
	}

	.format-card {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		position: relative;
	}

	.format-card:hover {
		border-color: var(--color-primary);
		transform: translateY(-2px);
		box-shadow: var(--shadow-sm);
	}

	.format-card.active {
		background: rgba(var(--color-primary-rgb), 0.05);
		border-color: var(--color-primary);
	}

	.format-icon {
		width: 32px;
		height: 32px;
		border-radius: var(--border-radius-sm);
		background: var(--color-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-secondary);
	}

	.format-card.active .format-icon {
		color: var(--color-primary);
		background: rgba(var(--color-primary-rgb), 0.1);
	}

	.format-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.format-name {
		font-weight: 600;
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}

	.format-desc {
		font-size: 10px;
		color: var(--color-text-muted);
	}

	.check-icon {
		color: var(--color-primary);
	}
	
	.error-banner {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--color-error);
		color: var(--color-error);
		padding: var(--spacing-md);
		border-radius: var(--border-radius-sm);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}
	
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		color: var(--color-text-secondary);
		gap: var(--spacing-md);
	}

	.spinner {
		width: 30px;
		height: 30px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	
	.result-section {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 200px;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		overflow: hidden;
	}
	
	.result-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
	}
	
	.result-header h3 {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	
	.result-stats {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-family: var(--font-mono);
	}
	
	.result-container {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.result-container :global(.code-block) {
		border-radius: 0;
		border: none;
	}
	
	/* Footer */
	.footer-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.action-buttons {
		display: flex;
		gap: var(--spacing-md);
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

	.destination-tabs {
		display: flex;
		gap: var(--spacing-sm);
		background: var(--color-surface-secondary);
		padding: var(--spacing-xs);
		border-radius: var(--border-radius-md);
		border: 1px solid var(--color-border);
	}

	.dest-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-radius: var(--border-radius-sm);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.dest-tab:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}

	.dest-tab.active {
		background: var(--color-surface);
		color: var(--color-primary);
		box-shadow: var(--shadow-sm);
	}

	.destination-config {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
	}

	.destination-config label {
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

	.text-input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		background: var(--color-background);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}

	.text-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.help-text {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.inline-error {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-error);
		font-size: var(--font-size-sm);
	}

	.inline-success {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-success);
		font-size: var(--font-size-sm);
	}

	.webhook-preview {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: rgba(var(--color-primary-rgb), 0.1);
		border-radius: var(--border-radius-sm);
		color: var(--color-primary);
		font-size: var(--font-size-xs);
	}

	.gist-options {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.checkbox-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.gist-result {
		border: 1px solid var(--color-success);
		border-radius: var(--border-radius-md);
		overflow: hidden;
		background: rgba(34, 197, 94, 0.05);
	}

	.gist-result-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: rgba(34, 197, 94, 0.1);
		color: var(--color-success);
		font-weight: 500;
		font-size: var(--font-size-sm);
	}

	.gist-url {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-md);
		gap: var(--spacing-md);
	}

	.gist-url code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text);
		word-break: break-all;
	}

	.gist-actions {
		display: flex;
		gap: var(--spacing-xs);
		flex-shrink: 0;
	}

	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-icon:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}
</style>