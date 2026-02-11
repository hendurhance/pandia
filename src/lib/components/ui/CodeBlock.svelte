<script lang="ts">
	import hljs from 'highlight.js/lib/core';
	import json from 'highlight.js/lib/languages/json';
	import javascript from 'highlight.js/lib/languages/javascript';
	import typescript from 'highlight.js/lib/languages/typescript';
	import python from 'highlight.js/lib/languages/python';
	import go from 'highlight.js/lib/languages/go';
	import rust from 'highlight.js/lib/languages/rust';
	import java from 'highlight.js/lib/languages/java';
	import csharp from 'highlight.js/lib/languages/csharp';
	import sql from 'highlight.js/lib/languages/sql';
	import xml from 'highlight.js/lib/languages/xml';
	import yaml from 'highlight.js/lib/languages/yaml';
	import bash from 'highlight.js/lib/languages/bash';
	import Icon from './Icon.svelte';

	hljs.registerLanguage('json', json);
	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('typescript', typescript);
	hljs.registerLanguage('python', python);
	hljs.registerLanguage('go', go);
	hljs.registerLanguage('rust', rust);
	hljs.registerLanguage('java', java);
	hljs.registerLanguage('csharp', csharp);
	hljs.registerLanguage('sql', sql);
	hljs.registerLanguage('xml', xml);
	hljs.registerLanguage('html', xml);
	hljs.registerLanguage('yaml', yaml);
	hljs.registerLanguage('bash', bash);
	hljs.registerLanguage('shell', bash);

	const languageAliases: Record<string, string> = {
		'js': 'javascript',
		'ts': 'typescript',
		'py': 'python',
		'rb': 'ruby',
		'cs': 'csharp',
		'c#': 'csharp',
		'sh': 'bash',
		'zsh': 'bash',
		'htm': 'html',
	};

	interface Props {
		code: string;
		language?: string;
		showLineNumbers?: boolean;
		showCopyButton?: boolean;
		maxHeight?: string;
		wrap?: boolean;
		class?: string;
	}

	let {
		code,
		language = 'json',
		showLineNumbers = false,
		showCopyButton = true,
		maxHeight = 'none',
		wrap = false,
		class: className = '',
	}: Props = $props();

	let copied = $state(false);

	function normalizeLanguage(lang: string): string {
		const normalized = lang.toLowerCase().trim();
		return languageAliases[normalized] || normalized;
	}

	let highlightedCode = $derived.by(() => {
		if (!code) return '';

		const lang = normalizeLanguage(language);

		try {
			// Check if language is registered
			if (hljs.getLanguage(lang)) {
				return hljs.highlight(code, { language: lang }).value;
			}
			// Fallback to auto-detection
			return hljs.highlightAuto(code).value;
		} catch {
			// If highlighting fails, return escaped code
			return escapeHtml(code);
		}
	});

	let lineNumbers = $derived.by(() => {
		if (!showLineNumbers || !code) return [];
		return code.split('\n').map((_, i) => i + 1);
	});

	function escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}
</script>

<div class="code-block {className}" class:has-line-numbers={showLineNumbers}>
	{#if showCopyButton}
		<button
			class="copy-button"
			class:copied
			onclick={copyToClipboard}
			title={copied ? 'Copied!' : 'Copy code'}
			aria-label={copied ? 'Copied!' : 'Copy code'}
		>
			<Icon name={copied ? 'check' : 'copy'} size={14} />
			{#if copied}
				<span class="copy-text">Copied!</span>
			{/if}
		</button>
	{/if}

	<div class="code-container" style:max-height={maxHeight}>
		{#if showLineNumbers}
			<div class="line-numbers" aria-hidden="true">
				{#each lineNumbers as num}
					<span class="line-number">{num}</span>
				{/each}
			</div>
		{/if}
		<pre class:wrap><code class="hljs">{@html highlightedCode}</code></pre>
	</div>
</div>

<style>
	.code-block {
		position: relative;
		background: var(--color-code-background, #1e1e1e);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md, 6px);
		overflow: hidden;
	}

	.code-container {
		display: flex;
		overflow: auto;
		max-height: inherit;
	}

	.line-numbers {
		display: flex;
		flex-direction: column;
		padding: 12px 0;
		background: var(--color-code-gutter, rgba(255, 255, 255, 0.03));
		border-right: 1px solid var(--color-border);
		user-select: none;
		flex-shrink: 0;
	}

	.line-number {
		padding: 0 12px;
		font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-muted);
		text-align: right;
		min-width: 2.5em;
	}

	pre {
		margin: 0;
		padding: 12px 16px;
		flex: 1;
		min-width: 0;
	}

	pre.wrap {
		white-space: pre-wrap;
		word-break: break-word;
	}

	code {
		font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-code-foreground, #d4d4d4);
		background: transparent;
	}

	.copy-button {
		position: absolute;
		top: 8px;
		right: 8px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm, 4px);
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
		opacity: 0;
		transition: all 0.15s ease;
		z-index: 1;
	}

	.code-block:hover .copy-button {
		opacity: 1;
	}

	.copy-button:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
		border-color: var(--color-border-focus);
	}

	.copy-button.copied {
		opacity: 1;
		background: var(--color-success-background, rgba(46, 160, 67, 0.15));
		border-color: var(--color-success);
		color: var(--color-success);
	}

	.copy-text {
		font-weight: 500;
	}

	.code-container::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}

	.code-container::-webkit-scrollbar-track {
		background: transparent;
	}

	.code-container::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 4px;
	}

	.code-container::-webkit-scrollbar-thumb:hover {
		background: var(--color-text-muted);
	}

	:global(.code-block .hljs) {
		background: transparent;
		color: var(--color-code-foreground, #d4d4d4);
	}

	:global(.code-block .hljs-keyword) {
		color: var(--color-syntax-keyword, #c586c0);
	}

	:global(.code-block .hljs-string) {
		color: var(--color-syntax-string, #ce9178);
	}

	:global(.code-block .hljs-number) {
		color: var(--color-syntax-number, #b5cea8);
	}

	:global(.code-block .hljs-literal),
	:global(.code-block .hljs-built_in) {
		color: var(--color-syntax-boolean, #569cd6);
	}

	:global(.code-block .hljs-attr),
	:global(.code-block .hljs-property) {
		color: var(--color-syntax-key, #9cdcfe);
	}

	:global(.code-block .hljs-comment) {
		color: var(--color-syntax-comment, #6a9955);
		font-style: italic;
	}

	:global(.code-block .hljs-punctuation) {
		color: var(--color-syntax-operator, #d4d4d4);
	}

	:global(.code-block .hljs-function),
	:global(.code-block .hljs-title) {
		color: var(--color-syntax-function, #dcdcaa);
	}

	:global(.code-block .hljs-class),
	:global(.code-block .hljs-type) {
		color: var(--color-syntax-type, #4ec9b0);
	}

	:global(.code-block .hljs-variable) {
		color: var(--color-syntax-variable, #9cdcfe);
	}

	:global(.code-block .hljs-tag) {
		color: var(--color-syntax-tag, #569cd6);
	}

	:global(.code-block .hljs-name) {
		color: var(--color-syntax-tag, #569cd6);
	}

	:global(.code-block .hljs-attribute) {
		color: var(--color-syntax-attribute, #9cdcfe);
	}

	:global(.code-block .hljs-selector-class),
	:global(.code-block .hljs-selector-id) {
		color: var(--color-syntax-selector, #d7ba7d);
	}

	:global(.code-block .hljs-meta) {
		color: var(--color-syntax-meta, #9b9b9b);
	}
</style>
