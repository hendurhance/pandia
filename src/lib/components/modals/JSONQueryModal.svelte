<script lang="ts">
	import { JSONQueryProcessor, type QueryEngine, type QueryResult, type QueryExample } from '$lib/services/query';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
		onapply?: (event: { result: any; query: string; engine: QueryEngine }) => void;
		onnotification?: (event: { type: string; message: string }) => void;
	}

	let { visible = $bindable(false), content = '', onclose, onapply, onnotification }: Props = $props();

	let selectedEngine: QueryEngine = $state('jmespath');
	let query = $state('');
	let queryResult: QueryResult | null = $state(null);
	let isExecuting = $state(false);
	let activeTab = $state('query');
	let queryHistory: string[] = $state([]);
	let currentData: any = $state(null);

	let visualSteps: Array<{
		type: 'filter' | 'sort' | 'map';
		config: {
			field?: string;
			operator?: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'startsWith' | 'endsWith';
			value?: string;
			direction?: 'asc' | 'desc';
		}
	}> = $state([]);
	let availableFields: string[] = $state([]);
	let selectedField: string | null = $state(null);

	let queryEditor: HTMLTextAreaElement | null = $state(null);
	let queryTimeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (visible) {
			loadQueryHistory();
		}
	});

	// Parse input data when content changes
	let lastParsedContent = '';
	$effect(() => {
		if (visible && content && content !== lastParsedContent) {
			lastParsedContent = content;
			parseInputData();
		}
	});

	function parseInputData() {
		if (!visible) return;
		try {
			const parsedData = JSON.parse(content);
			const extractedFields = extractAvailableFields(parsedData);
			
			currentData = parsedData;
			availableFields = extractedFields;
		} catch (error) {
			currentData = null;
			availableFields = [];
			if (visible) {
				onnotification?.({ type: 'error', message: 'Invalid JSON data provided' });
			}
		}
	}

	function extractAvailableFields(data: any, prefix = ''): string[] {
		const fields = new Set<string>();
		
		function traverse(obj: any, path: string) {
			if (obj === null || obj === undefined) return;
			
			if (Array.isArray(obj)) {
				if (path) fields.add(path);
				if (obj.length > 0) {
					traverse(obj[0], path);
				}
			} else if (typeof obj === 'object') {
				for (const [key, value] of Object.entries(obj)) {
					const newPath = path ? `${path}.${key}` : key;
					fields.add(newPath);
					
					if (typeof value === 'object' && value !== null) {
						traverse(value, newPath);
					}
				}
			}
		}
		
		traverse(data, prefix);
		return Array.from(fields).sort();
	}

	function loadQueryHistory() {
		const saved = localStorage.getItem('pandia-query-history');
		if (saved) {
			try {
				queryHistory = JSON.parse(saved);
			} catch {
				queryHistory = [];
			}
		}
	}

	function saveToHistory(q: string) {
		if (q && !queryHistory.includes(q)) {
			queryHistory = [q, ...queryHistory.slice(0, 9)];
			localStorage.setItem('pandia-query-history', JSON.stringify(queryHistory));
		}
	}

	async function executeQuery() {
		if (!currentData) {
			onnotification?.({ type: 'warning', message: 'Please provide both data and query' });
			return;
		}

		if (!query.trim() && selectedEngine === 'jsonquery') {
			query = 'get()';
		}

		if (!query.trim()) {
			onnotification?.({ type: 'warning', message: 'Please provide both data and query' });
			return;
		}

		isExecuting = true;
		
		try {
			queryResult = await JSONQueryProcessor.executeAsync(currentData, query, selectedEngine);
			
			if (queryResult.success) {
				saveToHistory(query);
				onnotification?.({ type: 'success', message: `Query executed in ${queryResult.executionTimeMs.toFixed(2)}ms` });
			} else {
				onnotification?.({ type: 'error', message: queryResult.error.message || 'Query execution failed' });
			}
		} catch (error) {
			onnotification?.({ type: 'error', message: (error as Error).message });
		} finally {
			isExecuting = false;
		}
	}

	function handleQueryChange() {
		if (queryTimeout) clearTimeout(queryTimeout);
		queryTimeout = setTimeout(() => {
			validateCurrentQuery();
		}, 500);
	}

	function validateCurrentQuery() {
		if (!query.trim()) return;
		
		const validation = JSONQueryProcessor.validate(query, selectedEngine);
		if (!validation.isValid && validation.error) {
			onnotification?.({ type: 'warning', message: `Syntax warning: ${validation.error}` });
		}
	}

	function switchEngine(engine: QueryEngine) {
		selectedEngine = engine;
		queryResult = null;
		
		if (!query) {
			const examples = JSONQueryProcessor.getExamples(engine);
			if (examples.length > 0) {
				query = examples[0].query;
			}
		}
	}

	function useExample(example: QueryExample) {
		query = example.query;
		activeTab = 'query';
		executeQuery();
	}

	function useHistoryQuery(historyQuery: string) {
		query = historyQuery;
		activeTab = 'query';
		executeQuery();
	}

	function applyQueryResult() {
		if (queryResult && queryResult.success) {
			onapply?.({
				result: queryResult.result,
				query: queryResult.query,
				engine: queryResult.engine
			});
			close();
		}
	}

	function addVisualStep(type: 'filter' | 'sort' | 'map') {
		const config = type === 'filter' ? { operator: '==' as const } : 
					  type === 'sort' ? { direction: 'asc' as const } : {};
		visualSteps = [...visualSteps, { type, config }];
	}

	function removeVisualStep(index: number) {
		visualSteps = visualSteps.filter((_, i) => i !== index);
	}

	function selectField(field: string) {
		if (selectedField === field) {
			selectedField = null;
		} else {
			selectedField = field;
		}
	}

	function applyFieldToStep(stepIndex: number) {
		if (selectedField && visualSteps[stepIndex]) {
			visualSteps[stepIndex].config.field = selectedField;
			visualSteps = [...visualSteps];
			selectedField = null;
		}
	}

	function handleFieldInputFocus(stepIndex: number) {
		if (selectedField) {
			applyFieldToStep(stepIndex);
		}
	}

	function convertVisualToQuery(): string {
		let result = '';
		const jqParts: string[] = [];

		const filters = visualSteps.filter((s) => s.type === 'filter');
		const sorts = visualSteps.filter((s) => s.type === 'sort');
		const maps = visualSteps.filter((s) => s.type === 'map');

		function ensureJsonQueryPath(field?: string): string {
			if (!field) return '';
			return field.startsWith('.') ? field : `.${field}`;
		}

		function escapeRegex(text: string): string {
			return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}

		function toJSONQueryValue(raw?: string): string {
			if (raw === undefined) return 'null';
			const trimmed = raw.trim();
			if (trimmed === '') return '""';
			if (trimmed === 'true' || trimmed === 'false') return trimmed;
			if (trimmed === 'null') return 'null';
			const num = Number(trimmed);
			if (!Number.isNaN(num) && trimmed.match(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i)) {
				return trimmed;
			}
			return JSON.stringify(trimmed);
		}
		
		function processStep(step: typeof visualSteps[number]) {
			switch (step.type) {
				case 'filter':
					if (selectedEngine === 'jmespath') {
						const operator = step.config.operator === '==' ? '==' : 
										step.config.operator === '!=' ? '!=' :
										step.config.operator === '<' ? '<' :
										step.config.operator === '<=' ? '<=' :
										step.config.operator === '>' ? '>' :
										step.config.operator === '>=' ? '>=' :
										step.config.operator === 'contains' ? 'contains' : '==';
						result += `[?${step.config.field} ${operator} \`${step.config.value}\`]`;
					} else if (selectedEngine === 'jsonquery') {
						const field = ensureJsonQueryPath(step.config.field);
						const op = step.config.operator || '==';
						if (op === 'contains' || op === 'startsWith' || op === 'endsWith') {
							const pattern = step.config.value ? (
								op === 'contains' ? escapeRegex(step.config.value) :
								op === 'startsWith' ? `^${escapeRegex(step.config.value)}` :
								`${escapeRegex(step.config.value)}$`
							) : '';
							jqParts.push(`filter(regex(${field}, ${JSON.stringify(pattern)}))`);
						} else {
							const value = toJSONQueryValue(step.config.value);
							jqParts.push(`filter(${field} ${op} ${value})`);
						}
					} else if (selectedEngine === 'lodash') {
						const op = step.config.operator === '==' ? '===' : step.config.operator;
						result = result ? `filter(${result}, item => item.${step.config.field} ${op} '${step.config.value}')` :
										 `filter(data, item => item.${step.config.field} ${op} '${step.config.value}')`;
					}
					break;
				case 'sort':
					if (selectedEngine === 'jmespath') {
						result += `| sort_by(@, &${step.config.field})`;
						if (step.config.direction === 'desc') {
							result += ' | reverse(@)';
						}
					} else if (selectedEngine === 'jsonquery') {
						const field = ensureJsonQueryPath(step.config.field);
						const dir = step.config.direction || 'asc';
						jqParts.push(`sort(${field}, ${JSON.stringify(dir)})`);
					} else if (selectedEngine === 'lodash') {
						const base = result || 'data';
						result = `orderBy(${base}, '${step.config.field}', '${step.config.direction || 'asc'}')`;
					}
					break;
				case 'map':
					if (selectedEngine === 'jmespath') {
						result += `[*].${step.config.field}`;
					} else if (selectedEngine === 'jsonquery') {
						const field = ensureJsonQueryPath(step.config.field);
						jqParts.push(`map(${field})`);
					} else if (selectedEngine === 'lodash') {
						const base = result || 'data';
						result = `map(${base}, '${step.config.field}')`;
					}
					break;
			}
		}

		for (const step of filters) processStep(step);
		for (const step of sorts) processStep(step);
		for (const step of maps) processStep(step);
		
		if (selectedEngine === 'jsonquery') {
			return jqParts.join(' | ');
		}
		
		return result || (selectedEngine === 'lodash' ? 'data' : '');
	}

	function generateQueryFromVisual() {
		query = convertVisualToQuery();
		activeTab = 'query';
		executeQuery();
	}

	async function copyQuery() {
		const success = await copyToClipboard(query);
		if (success) {
			onnotification?.({ type: 'success', message: 'Query copied to clipboard' });
		}
	}

	async function copyResult() {
		if (queryResult?.success && queryResult.result) {
			const resultStr = JSON.stringify(queryResult.result, null, 2);
			const success = await copyToClipboard(resultStr);
			if (success) {
				onnotification?.({ type: 'success', message: 'Result copied to clipboard' });
			}
		}
	}

	function clearQuery() {
		query = '';
		queryResult = null;
		visualSteps = [];
		selectedField = null;
		if (queryEditor) {
			queryEditor.focus();
		}
	}

	function close() {
		visible = false;
		queryResult = null;
		query = '';
		visualSteps = [];
		activeTab = 'query';
		onclose?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			executeQuery();
		} else if (event.key === 'Escape') {
			close();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<BaseModal
	bind:visible
	title="JSON Query"
	subtitle="Filter, transform, and sort your data"
	icon="search"
	width="full"
	onclose={close}
>
	<div class="modal-body">
				<!-- Left Panel: Query Input -->
				<div class="panel left-panel">
					<div class="panel-toolbar">
						<div class="engine-tabs">
							<button class="engine-tab {selectedEngine === 'jmespath' ? 'active' : ''}" onclick={() => switchEngine('jmespath')}>JMESPath</button>
							<button class="engine-tab {selectedEngine === 'jsonquery' ? 'active' : ''}" onclick={() => switchEngine('jsonquery')}>JSONQuery</button>
							<button class="engine-tab {selectedEngine === 'lodash' ? 'active' : ''}" onclick={() => switchEngine('lodash')}>Lodash</button>
						</div>
					</div>

					<div class="mode-tabs">
						<button class="mode-tab {activeTab === 'query' ? 'active' : ''}" onclick={() => activeTab = 'query'}>
							<Icon name="code" size={14} /> Code
						</button>
						<button class="mode-tab {activeTab === 'visual' ? 'active' : ''}" onclick={() => activeTab = 'visual'}>
							<Icon name="eye" size={14} /> Visual Builder
						</button>
						<button class="mode-tab {activeTab === 'history' ? 'active' : ''}" onclick={() => activeTab = 'history'}>
							<Icon name="history" size={14} /> History
						</button>
						<button class="mode-tab {activeTab === 'examples' ? 'active' : ''}" onclick={() => activeTab = 'examples'}>
							<Icon name="lightbulb" size={14} /> Examples
						</button>
					</div>

					<div class="panel-body">
						{#if activeTab === 'query'}
							<div class="code-editor-container">
								<textarea
									bind:this={queryEditor}
									bind:value={query}
									oninput={handleQueryChange}
									placeholder={`Enter ${selectedEngine} query here...`}
									class="query-input"
									spellcheck="false"
								></textarea>
								<div class="editor-footer">
									<button class="btn btn-sm btn-secondary" onclick={clearQuery} disabled={!query && !queryResult}>
										<Icon name="close" size={12} /> Clear
									</button>
									<div class="editor-actions">
										<button class="btn btn-sm btn-secondary" onclick={copyQuery} disabled={!query}>Copy</button>
										<button class="btn btn-sm btn-primary" onclick={executeQuery} disabled={isExecuting}>
											{isExecuting ? 'Running...' : 'Run Query (Ctrl+Enter)'}
										</button>
									</div>
								</div>
							</div>
						{:else if activeTab === 'visual'}
							<div class="visual-builder">
								<div class="vb-actions">
									<button class="btn btn-sm btn-outline" onclick={() => addVisualStep('filter')}>+ Filter</button>
									<button class="btn btn-sm btn-outline" onclick={() => addVisualStep('sort')}>+ Sort</button>
									<button class="btn btn-sm btn-outline" onclick={() => addVisualStep('map')}>+ Map</button>
								</div>
								
								<div class="vb-steps">
									{#each visualSteps as step, index}
										<div class="vb-step">
											<div class="step-header">
												<span class="step-badge {step.type}">{step.type}</span>
												<button class="icon-btn remove-btn" onclick={() => removeVisualStep(index)}>
													<Icon name="close" size={14} />
												</button>
											</div>
											<div class="step-body">
												{#if step.type === 'filter'}
													<input
														class="vb-input field-input"
														class:has-value={!!step.config.field}
														class:awaiting-field={selectedField !== null}
														placeholder={selectedField ? `Click to insert "${selectedField}"` : "Select field or type..."}
														bind:value={step.config.field}
														list="vb-fields"
														autocapitalize="off"
														spellcheck="false"
														onfocus={() => handleFieldInputFocus(index)}
													/>
													<select class="vb-select" bind:value={step.config.operator}>
														<option value="==">equals</option>
														<option value="!=">not equals</option>
														<option value="contains">contains</option>
														<option value=">">&gt;</option>
														<option value="<">&lt;</option>
													</select>
													<input class="vb-input" placeholder="Value" bind:value={step.config.value} autocapitalize="off" spellcheck="false" />
												{:else if step.type === 'sort'}
													<input
														class="vb-input field-input"
														class:has-value={!!step.config.field}
														class:awaiting-field={selectedField !== null}
														placeholder={selectedField ? `Click to insert "${selectedField}"` : "Select field or type..."}
														bind:value={step.config.field}
														list="vb-fields"
														autocapitalize="off"
														spellcheck="false"
														onfocus={() => handleFieldInputFocus(index)}
													/>
													<select class="vb-select" bind:value={step.config.direction}>
														<option value="asc">Ascending</option>
														<option value="desc">Descending</option>
													</select>
												{:else}
													<input
														class="vb-input field-input"
														class:has-value={!!step.config.field}
														class:awaiting-field={selectedField !== null}
														placeholder={selectedField ? `Click to insert "${selectedField}"` : "Select field or type..."}
														bind:value={step.config.field}
														list="vb-fields"
														autocapitalize="off"
														spellcheck="false"
														onfocus={() => handleFieldInputFocus(index)}
													/>
												{/if}
											</div>
										</div>
									{/each}
									{#if visualSteps.length === 0}
										<div class="empty-vb">
											<Icon name="layers" size={32} />
											<p>Add steps to build your query visually</p>
											<span class="empty-hint">Use the buttons above to add Filter, Sort, or Map steps</span>
										</div>
									{/if}
								</div>
								
								{#if visualSteps.length > 0}
									<div class="vb-footer">
										<button class="btn btn-primary full-width" onclick={generateQueryFromVisual}>Generate & Run</button>
									</div>
								{/if}
							</div>
						{:else if activeTab === 'history'}
							<div class="list-view">
								{#if queryHistory.length === 0}
									<div class="empty-list">No history yet</div>
								{/if}
								{#each queryHistory as item}
									<button class="list-item" onclick={() => useHistoryQuery(item)}>
										<code>{item}</code>
									</button>
								{/each}
							</div>
						{:else if activeTab === 'examples'}
							<div class="list-view">
								{#each JSONQueryProcessor.getExamples(selectedEngine) as example}
									<button class="list-item example" onclick={() => useExample(example)}>
										<span class="example-name">{example.name}</span>
										<code>{example.query}</code>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Right Panel: Results or Data Explorer -->
				<div class="panel right-panel">
					<div class="panel-header">
						<h3>{queryResult ? 'Results' : 'Available Fields'}</h3>
						{#if queryResult && queryResult.success}
							<span class="badge">{Array.isArray(queryResult.result) ? queryResult.result.length : 1} items</span>
						{:else if !queryResult && availableFields.length > 0}
							<span class="badge">{availableFields.length} fields</span>
						{/if}
					</div>

					<div class="panel-body result-body">
						{#if queryResult}
							{#if queryResult.success}
								<div class="result-meta">
									<span>Executed in {queryResult.executionTimeMs.toFixed(2)}ms</span>
								</div>
								<div class="result-code-wrapper">
									<CodeBlock
										code={JSON.stringify(queryResult.result, null, 2)}
										language="json"
										showLineNumbers={false}
									/>
								</div>
							{:else}
								<div class="error-state">
									<Icon name="warning" size={32} />
									<h4>Query Failed</h4>
									<p>{queryResult.error.message}</p>
								</div>
							{/if}
						{:else if currentData}
							<div class="data-explorer">
								<div class="fields-hint">
									{#if activeTab === 'visual'}
										<Icon name="info" size={14} />
										{#if selectedField}
											<span>Field "<strong>{selectedField}</strong>" selected. Click a field input to apply.</span>
										{:else}
											<span>Click a field to select, then click on a step's field input</span>
										{/if}
									{:else}
										<Icon name="info" size={14} />
										<span>Click a field to insert it into your query</span>
									{/if}
								</div>
								<div class="fields-list">
									{#each availableFields as field}
										<button
											class="field-chip"
											class:selected={selectedField === field}
											onclick={() => {
												if (activeTab === 'query') {
													query += field;
												} else if (activeTab === 'visual') {
													selectField(field);
												}
											}}
										>
											<Icon name={activeTab === 'visual' ? 'plus' : 'code'} size={12} />
											{field}
										</button>
									{/each}
								</div>
							</div>
						{:else}
							<div class="empty-state">
								<Icon name="database" size={48} />
								<p>No data loaded</p>
							</div>
						{/if}
					</div>
				</div>
	</div>

	{#snippet footer()}
		<div class="footer-content">
			<div class="footer-info">
				{#if currentData}
					<span>Data loaded</span>
				{/if}
			</div>
			<div class="footer-actions">
				<button class="btn btn-secondary" onclick={close}>Cancel</button>
				<button class="btn btn-primary" onclick={applyQueryResult} disabled={!queryResult?.success}>
					<Icon name="success" size={16} /> Apply Result
				</button>
			</div>
		</div>
	{/snippet}
</BaseModal>

<datalist id="vb-fields">
	{#each availableFields as f}
		<option value={f}></option>
	{/each}
</datalist>

<style>
	.modal-body {
		display: grid;
		grid-template-columns: 1fr 1fr;
		height: 70vh;
		background: var(--color-border);
		gap: 1px;
	}

	.icon-btn {
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: var(--spacing-xs);
		border-radius: var(--border-radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.icon-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.panel {
		background: var(--color-surface);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.panel-toolbar {
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-secondary);
	}

	.engine-tabs {
		display: flex;
		background: var(--color-background-secondary);
		padding: 4px;
		border-radius: var(--border-radius-md);
		gap: 4px;
	}

	.engine-tab {
		flex: 1;
		padding: 6px 12px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: var(--border-radius-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
		font-weight: 500;
		transition: all 0.2s;
	}

	.engine-tab.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	.mode-tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.mode-tab {
		flex: 1;
		padding: var(--spacing-md);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: var(--font-size-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-sm);
		border-bottom: 2px solid transparent;
	}

	.mode-tab:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.mode-tab.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.code-editor-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: var(--spacing-md);
		gap: var(--spacing-md);
	}

	.query-input {
		flex: 1;
		background: var(--color-editor-background);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		color: var(--color-editor-foreground);
		padding: var(--spacing-md);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		resize: none;
	}

	.query-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.editor-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.editor-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.visual-builder {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.vb-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.vb-steps {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.vb-step {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
	}

	.step-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.step-badge {
		font-size: 10px;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: 4px;
		font-weight: 600;
		letter-spacing: 0.025em;
	}

	.step-badge.filter { background: #3b82f6; color: #ffffff; }
	.step-badge.sort { background: #10b981; color: #ffffff; }
	.step-badge.map { background: #d97706; color: #ffffff; }

	.step-body {
		display: flex;
		gap: var(--spacing-sm);
	}

	.vb-input, .vb-select {
		flex: 1;
		background: var(--color-surface, #1e1e1e);
		border: 1px solid var(--color-border, #333333);
		padding: 8px 10px;
		border-radius: var(--border-radius-sm);
		color: var(--color-text, #ffffff);
		font-size: var(--font-size-sm);
	}

	.vb-input::placeholder {
		color: var(--color-text-muted, #888888);
	}

	.vb-input:focus, .vb-select:focus {
		outline: none;
		border-color: var(--color-primary, #007acc);
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
	}

	.empty-vb {
		text-align: center;
		padding: var(--spacing-xl);
		color: var(--color-text-secondary, #cccccc);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.empty-vb p {
		margin: 0;
		font-weight: 500;
		color: var(--color-text, #ffffff);
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-secondary, #cccccc);
	}

	.field-input {
		border-style: dashed;
		transition: all 0.2s;
	}

	.field-input.has-value {
		border-style: solid;
	}

	.field-input.awaiting-field {
		border-color: var(--color-primary);
		animation: pulse-border 1.5s ease-in-out infinite;
	}

	@keyframes pulse-border {
		0%, 100% { border-color: var(--color-primary); }
		50% { border-color: var(--color-border); }
	}

	.list-view {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.list-item {
		text-align: left;
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--border-radius-sm);
		cursor: pointer;
		transition: all 0.2s;
	}

	.list-item:hover {
		border-color: var(--color-primary);
		background: var(--color-surface-hover);
	}

	.list-item code {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.list-item.example {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.example-name {
		font-weight: 500;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.panel-header {
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-surface-secondary);
	}

	.panel-header h3 {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 600;
	}

	.badge {
		background: var(--color-surface);
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
		border: 1px solid var(--color-border);
	}

	.result-body {
		padding: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.result-meta {
		padding: var(--spacing-xs) var(--spacing-md);
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		font-size: 11px;
		color: var(--color-success);
	}

	.result-code-wrapper {
		flex: 1;
		overflow: hidden;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.result-code-wrapper :global(.code-block) {
		flex: 1;
		min-height: 0;
		border: none;
		border-radius: 0;
		display: flex;
		flex-direction: column;
	}

	.result-code-wrapper :global(.code-container) {
		flex: 1;
		min-height: 0;
		max-height: none;
		overflow: auto;
	}

	.data-explorer {
		padding: var(--spacing-md);
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.fields-hint {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-surface-secondary, #2d2d2d);
		border-radius: var(--border-radius-sm);
		margin-bottom: var(--spacing-md);
		font-size: 12px;
		color: var(--color-text-secondary, #cccccc);
		line-height: 1.4;
	}

	.fields-hint strong {
		color: var(--color-text, #ffffff);
		font-weight: 600;
	}

	.fields-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		flex: 1;
		align-content: flex-start;
		overflow-y: auto;
	}

	.field-chip {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--color-surface-hover, #3c3c3c);
		border: 1px solid var(--color-border-secondary, #555555);
		padding: 5px 12px;
		border-radius: 16px;
		font-size: 12px;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: all 0.2s;
		height: fit-content;
		user-select: none;
		color: var(--color-text, #ffffff);
		font-weight: 500;
	}

	.field-chip:hover {
		border-color: var(--color-primary, #007acc);
		color: #ffffff;
		background: var(--color-primary, #007acc);
	}

	.field-chip.selected {
		border-color: var(--color-primary, #007acc);
		background: var(--color-primary, #007acc);
		color: #ffffff;
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.4);
	}

	.field-chip:focus-visible {
		outline: 2px solid var(--color-border-focus, #007acc);
		outline-offset: 2px;
	}

	.field-chip:active {
		transform: scale(0.98);
	}

	.empty-state, .error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-text-secondary);
		gap: var(--spacing-md);
	}

	.error-state {
		color: var(--color-error);
	}

	.footer-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.footer-actions {
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

	.btn-sm {
		padding: 4px 10px;
		font-size: 12px;
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

	.btn-outline {
		background: transparent;
		border: 1px solid var(--color-primary);
		color: var(--color-primary);
	}

	.btn-outline:hover {
		background: rgba(59, 130, 246, 0.1);
	}

	.full-width {
		width: 100%;
		justify-content: center;
	}

	@media (max-width: 1200px) {
		.modal-body {
			grid-template-columns: 1.5fr 1fr;
		}
	}

	@media (max-width: 900px) {
		.modal-body {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr auto;
		}

		.right-panel {
			max-height: 250px;
			border-top: 1px solid var(--color-border);
		}

		.right-panel .panel-body {
			overflow-y: auto;
		}

		.fields-list {
			max-height: 150px;
		}
	}

	@media (max-width: 600px) {
		.modal-body {
			height: 60vh;
		}

		.mode-tabs {
			overflow-x: auto;
			flex-wrap: nowrap;
		}

		.mode-tab {
			flex: 0 0 auto;
			white-space: nowrap;
		}

		.engine-tabs {
			flex-wrap: wrap;
		}
	}
</style>