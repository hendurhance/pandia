<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';
	import BaseModal from './BaseModal.svelte';
	import { generateTypes, SupportedLanguage } from '../../services/codegen';
	import { formatError } from '../../utils/error';
	import { untrack } from 'svelte';

	interface Props {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
	}

	let { visible = $bindable(false), content = '', onclose }: Props = $props();

	function close() {
		visible = false;
		onclose?.();
	}

	let parsedData: any = $state(null);
	let generatedTypes = $state('');
	let selectedLanguage: SupportedLanguage = $state(SupportedLanguage.TypeScript);
	let error = $state('');
	let isLoading = $state(false);

	let lastVisible = false;
	let lastContent = '';

	$effect(() => {
		const currentVisible = visible;
		const currentContent = content;

		if (currentVisible && (currentVisible !== lastVisible || currentContent !== lastContent)) {
			untrack(() => {
				lastVisible = currentVisible;
				lastContent = currentContent;
				parseAndGenerate();
			});
		} else if (!currentVisible) {
			untrack(() => {
				lastVisible = false;
			});
		}
	});

	function parseAndGenerate() {
		try {
			parsedData = JSON.parse(content);
			error = '';
			generateTypeDefinitions();
		} catch (e) {
			parsedData = null;
			error = 'Invalid JSON. Please fix the JSON before generating types.';
			generatedTypes = '';
		}
	}

	async function generateTypeDefinitions() {
		if (!parsedData) return;
		isLoading = true;
		try {
			generatedTypes = await generateTypes(parsedData, selectedLanguage, {
				typeName: 'Root',
				tableName: 'generated_table'
			});
		} catch (e) {
			error = `Error generating types: ${formatError(e)}`;
			generatedTypes = '';
		} finally {
			isLoading = false;
		}
	}

	function handleLanguageChange() {
		generateTypeDefinitions();
	}

	function getHighlightLanguage(language: SupportedLanguage): string {
		const languageMap: Record<string, string> = {
			[SupportedLanguage.TypeScript]: 'typescript',
			[SupportedLanguage.Go]: 'go',
			[SupportedLanguage.Rust]: 'rust',
			[SupportedLanguage.Kotlin]: 'kotlin',
			[SupportedLanguage.Python]: 'python',
			[SupportedLanguage.Java]: 'java',
			[SupportedLanguage.Php]: 'php',
			[SupportedLanguage.JsonSchema]: 'json',
			[SupportedLanguage.Zod]: 'typescript',
			[SupportedLanguage.BigQuery]: 'json',
			[SupportedLanguage.MySQL]: 'sql',
			[SupportedLanguage.Mongoose]: 'javascript',
			[SupportedLanguage.GraphQL]: 'graphql'
		};
		return languageMap[language] || 'plaintext';
	}

</script>

<BaseModal
	bind:visible
	title="Generate Types"
	subtitle="Convert JSON to type definitions"
	icon="code"
	width="lg"
	showFooter={false}
	onclose={close}
>
	<div class="modal-body">
		<div class="language-bar">
			<div class="language-selector">
				<label for="language-select">Target Language</label>
				<div class="select-wrapper">
					<select
						id="language-select"
						bind:value={selectedLanguage}
						onchange={handleLanguageChange}
					>
						<optgroup label="Programming Languages">
							<option value={SupportedLanguage.TypeScript}>TypeScript</option>
							<option value={SupportedLanguage.Go}>Go</option>
							<option value={SupportedLanguage.Rust}>Rust</option>
							<option value={SupportedLanguage.Kotlin}>Kotlin</option>
							<option value={SupportedLanguage.Python}>Python (Pydantic)</option>
							<option value={SupportedLanguage.Java}>Java</option>
							<option value={SupportedLanguage.Php}>PHP DTO/VO</option>
						</optgroup>
						<optgroup label="Schema Definitions">
							<option value={SupportedLanguage.Zod}>Zod Schema</option>
							<option value={SupportedLanguage.JsonSchema}>JSON Schema</option>
							<option value={SupportedLanguage.GraphQL}>GraphQL</option>
							<option value={SupportedLanguage.Mongoose}>Mongoose</option>
						</optgroup>
						<optgroup label="Database">
							<option value={SupportedLanguage.BigQuery}>BigQuery</option>
							<option value={SupportedLanguage.MySQL}>MySQL</option>
						</optgroup>
					</select>
					<Icon name="chevron-down" size={14} class="select-icon" />
				</div>
			</div>
		</div>

		<div class="content-area">
			{#if error}
				<div class="error-state">
					<div class="error-icon">
						<Icon name="error" size={32} />
					</div>
					<h3>Parsing Error</h3>
					<p>{error}</p>
				</div>
			{:else if isLoading}
				<div class="loading-state">
					<div class="loading-spinner"></div>
					<h3>Generating Types...</h3>
					<p>Please wait while we generate your type definitions.</p>
				</div>
			{:else if generatedTypes}
				<div class="content-wrapper">
					<div class="toolbar">
						<div class="stats">
							<Icon name="file-text" size={14} />
							<span>{generatedTypes.split('\n').length} lines</span>
						</div>
					</div>
					<div class="code-container">
						<CodeBlock
							code={generatedTypes}
							language={getHighlightLanguage(selectedLanguage)}
							showLineNumbers={true}
							maxHeight="100%"
						/>
					</div>
				</div>
			{:else}
				<div class="empty-state">
					<div class="empty-icon">
						<Icon name="code" size={48} />
					</div>
					<h3>No Content</h3>
					<p>Select some JSON content to generate types.</p>
				</div>
			{/if}
		</div>
	</div>
</BaseModal>

<style>
	.modal-body {
		display: flex;
		flex-direction: column;
		height: 500px;
	}

	.language-bar {
		padding: var(--spacing-md) var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-secondary);
	}

	.language-selector {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.language-selector label {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.select-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.language-selector select {
		appearance: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		padding: 6px 32px 6px 12px;
		border-radius: var(--border-radius-sm);
		font-size: var(--font-size-sm);
		font-family: var(--font-sans);
		cursor: pointer;
		min-width: 160px;
		transition: all 0.2s;
	}

	.language-selector select:hover {
		border-color: var(--color-border-hover);
	}

	.language-selector select:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb, 59, 130, 246), 0.2);
	}

	.select-wrapper :global(.select-icon) {
		position: absolute;
		right: 10px;
		pointer-events: none;
		color: var(--color-text-secondary);
	}

	.content-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-editor-background);
	}

	.content-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.stats {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
	}

	.code-container {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.code-container :global(.code-block) {
		height: 100%;
		border: none;
		border-radius: 0;
	}

	.error-state, .empty-state, .loading-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		text-align: center;
	}

	.error-state {
		color: var(--color-error);
	}

	.empty-state, .loading-state {
		color: var(--color-text-secondary);
	}

	.error-icon, .empty-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: var(--spacing-lg);
	}

	.error-icon {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
	}

	.empty-icon {
		background: var(--color-surface-secondary);
		color: var(--color-text-muted);
	}

	.loading-spinner {
		width: 48px;
		height: 48px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: var(--spacing-lg);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	p {
		margin: 0;
		font-size: var(--font-size-sm);
		opacity: 0.8;
		max-width: 400px;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.language-bar {
			padding: var(--spacing-sm) var(--spacing-md);
		}

		.language-selector {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--spacing-xs);
		}

		.language-selector select {
			width: 100%;
		}
	}
</style>
