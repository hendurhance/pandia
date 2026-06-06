<script lang="ts">
	import { docGenerateTypes } from '$lib/ipc/doc';
	import type { DocHandle, TypegenLang } from '$lib/ipc/types';
	import { typegenPrefs, TYPEGEN_LANGS } from './state/typegen-prefs.svelte';
	import { stem } from '$lib/util/path';
	import { CopyFlag } from '$lib/util/clipboard.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { Check, Copy } from '@lucide/svelte';

	interface Context {
		handle: DocHandle;
		version: number;
		sourceName: string | null;
	}

	interface Props {
		context: Context | null;
	}

	let { context }: Props = $props();

	let output = $state('');
	let busy = $state(false);
	let error: string | null = $state(null);
	let seq = 0;
	const copyFlag = new CopyFlag();

	const lang = $derived(typegenPrefs.activeLang);

	function deriveTypeName(sourceName: string | null): string {
		if (!sourceName) return 'Root';
		const cleaned = stem(sourceName)
			.replace(/[^a-zA-Z0-9]+/g, '_')
			.split('_')
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join('');
		return cleaned || 'Root';
	}

	async function regenerate() {
		if (!context) {
			output = '';
			error = null;
			return;
		}
		const mySeq = ++seq;
		busy = true;
		error = null;
		try {
			const typeName = deriveTypeName(context.sourceName);
			const text = await docGenerateTypes(context.handle, lang, typeName);
			if (mySeq !== seq) return;
			output = text;
		} catch (e) {
			if (mySeq !== seq) return;
			output = '';
			error = String(e);
		} finally {
			if (mySeq === seq) busy = false;
		}
	}

	$effect(() => {
		void lang;
		void context?.handle;
		void context?.version;
		void regenerate();
	});

	async function onCopy() {
		if (!output) return;
		await copyFlag.copy(output);
	}

	const lineCount = $derived(output ? output.split('\n').length : 0);
</script>

<div class="panel">
	<div class="bar">
		<select
			class="lang-select"
			value={lang}
			onchange={(e) => typegenPrefs.setLang((e.target as HTMLSelectElement).value as TypegenLang)}
			aria-label="target language"
			disabled={!context}
		>
			{#each TYPEGEN_LANGS as l (l.id)}
				<option value={l.id}>{l.label}</option>
			{/each}
		</select>
		<div class="bar-right">
			<span
				class="status text-xs"
				data-kind={busy ? 'busy' : error ? 'err' : context ? 'ok' : 'none'}
			>
				{#if !context}—
				{:else if busy}…
				{:else if error}err
				{:else}{lineCount} ln
				{/if}
			</span>
			<button class="icon" onclick={onCopy} disabled={!output || busy} title="Copy to clipboard">
				<Icon icon={copyFlag.done ? Check : Copy} size="sm" />
			</button>
		</div>
	</div>

	{#if error}
		<div class="err-row notice text-xs">{error}</div>
	{/if}

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre class="preview" tabindex="0" aria-label="generated types preview"><code>{output || ''}</code
		></pre>
</div>

<style>
	.panel {
		gap: 0.4rem;
		min-width: 0;
		container-type: inline-size;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		flex-shrink: 0;
	}
	.bar-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
		flex: 0 0 auto;
	}

	.lang-select {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		padding: 0.15rem 0.3rem;
		background: var(--bg-elev);
		color: var(--text);
		border: var(--rule-width) solid var(--rule);
		flex: 0 1 auto;
		min-width: 80px;
		max-width: 100px;
		cursor: pointer;
	}

	@container (max-width: 180px) {
		.status {
			display: none;
		}
	}
	.lang-select:focus {
		outline: none;
		border-color: var(--accent);
	}
	.lang-select:disabled {
		color: var(--text-faint);
		cursor: default;
	}

	.status {
		flex-shrink: 0;
		text-align: right;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.status[data-kind='ok'] {
		color: var(--text-dim);
	}
	.status[data-kind='err'] {
		color: var(--danger);
	}
	.status[data-kind='busy'] {
		color: var(--warning);
	}

	.icon {
		font-size: 12px;
		padding: 0.1rem 0.45rem;
		min-width: 0;
		flex-shrink: 0;
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
	}
	.icon:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.icon:disabled {
		color: var(--text-faint);
		border-color: var(--rule);
		cursor: default;
	}
	.icon:disabled:hover {
		color: var(--text-faint);
		border-color: var(--rule);
	}

	.err-row {
		flex-shrink: 0;
	}

	.preview {
		flex: 1;
		min-height: 240px;
		margin: 0;
		padding: 0.5rem 0.6rem;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		line-height: 1.45;
		overflow: auto;
		white-space: pre;
		color: var(--text);
	}
	.preview:focus {
		outline: none;
		border-color: var(--accent);
	}
</style>
