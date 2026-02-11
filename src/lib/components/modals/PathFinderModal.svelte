<script lang="ts">
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { jsonPathService, COMMON_PATTERNS, type JSONPathResult } from '$lib/services/jsonpath';
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
		onpathSelected?: (event: { path: string; value: unknown }) => void;
		onnotification?: (event: { type: string; message: string }) => void;
	}

	let { visible = $bindable(false), content = '', onclose, onpathSelected, onnotification }: Props = $props();

	let jsonPathQuery = $state('');
	let searchResults: JSONPathResult[] = $state([]);
	let parsedData: unknown = null;
	let errorMessage = $state('');
	let selectedPath = $state('');
	let queryHistory: string[] = $state([]);
	let historyIndex = -1;
	let hasSearched = $state(false);
	let isSearching = $state(false);
	let showPatterns = $state(false);

	$effect(() => {
		if (visible && content) {
			parseContent();
			queryHistory = jsonPathService.getHistory();
			hasSearched = false;
		}
	});

	function parseContent() {
		try {
			parsedData = JSON.parse(content);
			errorMessage = '';
		} catch (error) {
			parsedData = null;
			errorMessage = `Invalid JSON: ${error}`;
		}
	}

	async function executeJSONPath() {
		hasSearched = true;
		isSearching = true;

		if (!parsedData || !jsonPathQuery.trim()) {
			searchResults = [];
			isSearching = false;
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 10));

		const result = jsonPathService.query(parsedData, jsonPathQuery.trim());

		if (result.error) {
			errorMessage = result.error;
			searchResults = [];
		} else {
			searchResults = result.results;
			errorMessage = '';
			queryHistory = jsonPathService.getHistory();
		}

		isSearching = false;
	}

	function selectResult(result: JSONPathResult) {
		selectedPath = result.path;
		onpathSelected?.({ path: result.path, value: result.value });
	}

	async function copyPath(path: string) {
		const success = await copyToClipboard(path);
		if (success) {
			onnotification?.({ type: 'success', message: 'Path copied to clipboard' });
		}
	}

	async function copyValue(value: unknown) {
		const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
		const success = await copyToClipboard(valueStr);
		if (success) {
			onnotification?.({ type: 'success', message: 'Value copied to clipboard' });
		}
	}

	function useHistoryQuery(query: string) {
		jsonPathQuery = query;
		executeJSONPath();
	}

	function close() {
		visible = false;
		searchResults = [];
		jsonPathQuery = '';
		selectedPath = '';
		errorMessage = '';
		hasSearched = false;
		onclose?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			executeJSONPath();
		} else if (event.key === 'ArrowUp' && event.ctrlKey) {
			event.preventDefault();
			if (historyIndex < queryHistory.length - 1) {
				historyIndex++;
				jsonPathQuery = queryHistory[historyIndex];
			}
		} else if (event.key === 'ArrowDown' && event.ctrlKey) {
			event.preventDefault();
			if (historyIndex > 0) {
				historyIndex--;
				jsonPathQuery = queryHistory[historyIndex];
			} else if (historyIndex === 0) {
				historyIndex = -1;
				jsonPathQuery = '';
			}
		}
	}
</script>

<BaseModal
	bind:visible
	title="JSONPath Finder"
	subtitle="Query and extract data using JSONPath syntax"
	icon="search"
	width="lg"
	onclose={close}
>
	<div class="modal-body">
				<div class="search-section">
					<div class="query-input-container">
						<div class="input-wrapper">
							<Icon name="search" size={16} class="input-icon" />
							<input
								id="jsonpath-input"
								type="text"
								bind:value={jsonPathQuery}
								onkeydown={handleKeydown}
								placeholder="e.g., $.users[*].name or $..address.city"
								class="query-input"
								autocomplete="off"
								autocapitalize="off"
								spellcheck="false"
							/>
							{#if isSearching}
								<div class="input-spinner">
									<Icon name="loading" size={16} class="spin" />
								</div>
							{/if}
						</div>
						<button class="btn btn-primary" onclick={executeJSONPath} disabled={isSearching}>
							Search
						</button>
					</div>

					{#if queryHistory.length > 0}
						<div class="history-section">
							<span class="history-label">Recent:</span>
							<div class="history-chips">
								{#each queryHistory.slice(0, 5) as query}
									<button
										class="chip"
										onclick={() => useHistoryQuery(query)}
										title="Use this query"
									>
										{query}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<div class="patterns-section">
						<button class="toggle-patterns" onclick={() => showPatterns = !showPatterns}>
							<Icon name={showPatterns ? 'chevron-down' : 'chevron-right'} size={14} />
							<span>Common Patterns Reference</span>
						</button>
						{#if showPatterns}
							<div class="patterns-grid">
								{#each COMMON_PATTERNS as pattern}
									<button
										class="pattern-item"
										onclick={() => useHistoryQuery(pattern.pattern)}
									>
										<code>{pattern.pattern}</code>
										<span class="pattern-desc">{pattern.description}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				{#if errorMessage}
					<div class="error-banner">
						<Icon name="error" size={16} />
						<span>{errorMessage}</span>
					</div>
				{/if}

				<div class="results-area">
					{#if searchResults.length > 0}
						<div class="results-header">
							<h3>Found {searchResults.length} matches</h3>
						</div>

						<div class="results-list">
							{#each searchResults as result}
								<div
									class="result-item {result.path === selectedPath ? 'selected' : ''}"
									onclick={() => selectResult(result)}
									onkeydown={(e) => e.key === 'Enter' && selectResult(result)}
									role="option"
									aria-selected={result.path === selectedPath}
									tabindex="0"
								>
									<div class="result-main">
										<div class="result-path-row">
											<code class="path-code">{result.path}</code>
											<button
												class="icon-btn copy-btn"
												onclick={(e) => { e.stopPropagation(); copyPath(result.path); }}
												title="Copy path"
											>
												<Icon name="clipboard" size={14} />
											</button>
										</div>
										<div class="result-value-row">
											<span class="type-badge">
												{typeof result.value === 'object' && result.value !== null
													? Array.isArray(result.value) ? 'Array' : 'Object'
													: typeof result.value}
											</span>
											<span class="value-preview-text">{jsonPathService.formatValue(result.value)}</span>
											<button
												class="icon-btn copy-btn"
												onclick={(e) => { e.stopPropagation(); copyValue(result.value); }}
												title="Copy value"
											>
												<Icon name="clipboard" size={14} />
											</button>
										</div>
									</div>
									{#if typeof result.value === 'object' && result.value !== null}
										<div class="value-code-block">
											<CodeBlock
												code={jsonPathService.getValuePreview(result.value)}
												language="json"
												showCopyButton={false}
												maxHeight="150px"
											/>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else if hasSearched && jsonPathQuery && !errorMessage && !isSearching}
						<div class="empty-state">
							<Icon name="info" size={24} />
							<span>No matches found for the JSONPath query.</span>
						</div>
					{/if}
				</div>
	</div>

	{#snippet footer()}
		<div class="footer-content">
			<div class="footer-info">
				{#if searchResults.length > 0}
					<span>{searchResults.length} result{searchResults.length === 1 ? '' : 's'}</span>
				{/if}
			</div>
			<button class="btn btn-secondary" onclick={close}>
				Cancel
			</button>
		</div>
	{/snippet}
</BaseModal>

<style>
	.modal-body {
		display: flex;
		flex-direction: column;
		max-height: 500px;
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

	.search-section {
		padding: 20px;
		border-bottom: 1px solid var(--color-border, #444);
		background: var(--color-surface, #2d2d2d);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.query-input-container {
		display: flex;
		gap: 10px;
	}

	.input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
	}

	.input-wrapper :global(.input-icon) {
		position: absolute;
		left: 12px;
		color: var(--color-text-secondary, #888);
		pointer-events: none;
	}

	.input-wrapper :global(.input-spinner) {
		position: absolute;
		right: 12px;
		color: var(--color-primary, #007acc);
		pointer-events: none;
		display: flex;
		align-items: center;
	}

	.query-input {
		width: 100%;
		padding: 10px 36px;
		border: 1px solid var(--color-border, #555);
		border-radius: 4px;
		background: var(--color-editor-background, #1e1e1e);
		color: var(--color-text, #fff);
		font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
		font-size: 14px;
		transition: all 0.2s;
	}

	.query-input:focus {
		outline: none;
		border-color: var(--color-primary, #007acc);
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
	}

	.history-section {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.history-label {
		color: var(--color-text-secondary, #999);
		font-size: 12px;
		white-space: nowrap;
	}

	.history-chips {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		overflow-x: auto;
	}

	.chip {
		background: var(--color-surface-secondary, #3c3c3c);
		border: 1px solid var(--color-border, #555);
		color: var(--color-text-secondary, #ccc);
		padding: 4px 10px;
		border-radius: 12px;
		cursor: pointer;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		transition: all 0.15s ease;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip:hover {
		background: var(--color-surface-hover, #4a4a4a);
		border-color: var(--color-border-secondary, #666);
		color: var(--color-text, #fff);
	}

	.patterns-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.toggle-patterns {
		background: none;
		border: none;
		color: var(--color-primary, #007acc);
		font-size: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0;
		width: fit-content;
	}

	.toggle-patterns:hover {
		text-decoration: underline;
	}

	.patterns-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 8px;
		padding: 10px;
		background: var(--color-surface-secondary, #252526);
		border-radius: 4px;
		border: 1px solid var(--color-border, #444);
	}

	.pattern-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border-radius: 4px;
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		text-align: left;
	}

	.pattern-item:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-border, #444);
	}

	.pattern-item code {
		color: #9cdcfe;
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 3px;
		font-family: var(--font-mono, monospace);
		font-size: 12px;
	}

	.pattern-desc {
		color: var(--color-text-secondary, #999);
		font-size: 12px;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.1);
		border-bottom: 1px solid rgba(239, 68, 68, 0.3);
		color: #ef4444;
		padding: 10px 20px;
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}

	.results-area {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-editor-background, #1e1e1e);
	}

	.results-area:has(.results-list) {
		flex: 1;
		min-height: 150px;
	}

	.results-header {
		padding: 8px 20px;
		background: var(--color-surface-secondary, #252526);
		border-bottom: 1px solid var(--color-border, #333);
	}

	.results-header h3 {
		margin: 0;
		color: var(--color-text-secondary, #ccc);
		font-size: 12px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.results-list {
		flex: 1;
		overflow-y: auto;
		padding: 0;
	}

	.result-item {
		padding: 12px 20px;
		border-bottom: 1px solid var(--color-border, #333);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.result-item:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.result-item.selected {
		background: rgba(0, 122, 204, 0.15);
		border-left: 3px solid var(--color-primary, #007acc);
		padding-left: 17px;
	}

	.result-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.result-path-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.path-code {
		color: #9cdcfe;
		font-family: var(--font-mono, monospace);
		font-size: 13px;
	}

	.result-value-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.type-badge {
		color: #569cd6;
		font-size: 11px;
		font-weight: 500;
		background: rgba(86, 156, 214, 0.1);
		padding: 1px 6px;
		border-radius: 4px;
		border: 1px solid rgba(86, 156, 214, 0.2);
	}

	.value-preview-text {
		color: #ce9178;
		font-family: var(--font-mono, monospace);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 400px;
	}

	.copy-btn {
		opacity: 0;
		padding: 4px;
	}

	.result-item:hover .copy-btn {
		opacity: 0.5;
	}

	.copy-btn:hover {
		opacity: 1 !important;
		background: rgba(255, 255, 255, 0.1);
	}

	.value-code-block {
		margin-top: 8px;
	}

	.value-code-block :global(.code-block) {
		border-radius: 4px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px;
		color: var(--color-text-secondary, #888);
	}

	.footer-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.footer-info {
		color: var(--color-text-secondary, #999);
		font-size: 12px;
	}

	.btn {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-family: inherit;
	}

	.btn-primary {
		background: var(--color-primary, #007acc);
		color: white;
	}

	.btn-primary:hover {
		background: #0062a3;
	}

	.btn-primary:disabled {
		background: rgba(0, 122, 204, 0.5);
		cursor: not-allowed;
		opacity: 0.7;
	}

	.btn-secondary {
		background: var(--color-surface-secondary, #3c3c3c);
		color: var(--color-text-secondary, #ccc);
		border: 1px solid var(--color-border, #555);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover, #4a4a4a);
		color: var(--color-text, #fff);
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
