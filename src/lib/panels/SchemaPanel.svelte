<script lang="ts">
	import type { DocContext } from '$lib/shell/state/workspace.svelte';
	import type { Path } from '$lib/ipc/bindings';
	import { ipc } from '$lib/ipc/client';
	import { lastResult, schemaSessions } from './state/schema-store.svelte';
	import { behaviorPrefs, SCHEMA_DEBOUNCE_MANUAL } from '$lib/settings/state/behavior-prefs.svelte';
	import { hasSchemaKeywords } from './schema-keywords';
	import { parseJsonPointer } from '$lib/util/path';

	interface Props {
		tabId: string;
		context: DocContext | null;

		onJump?: (path: Path) => void;
	}

	let { tabId, context, onJump }: Props = $props();

	const schema = $derived(schemaSessions.for(tabId));
	const result = $derived(lastResult(schema.verdict));
	const busy = $derived(schema.verdict.kind === 'checking');
	const problem = $derived(schema.verdict.kind === 'problem' ? schema.verdict.message : null);
	const manual = $derived(behaviorPrefs.schemaDebounceMs === SCHEMA_DEBOUNCE_MANUAL);

	$effect(() => {
		const v = schema.verdict;
		if (v.kind !== 'problem' || !v.retry || !behaviorPrefs.allowHttpSchemas) return;
		schema.verdict = { kind: 'problem', message: v.message }; // retry once
		void v.retry();
	});

	function onSchemaInput(e: Event) {
		schema.setText((e.target as HTMLTextAreaElement).value);
	}

	function onValidateNow() {
		void schema.validateNow();
	}

	function onClearSchema() {
		schema.clear();
	}

	async function jumpTo(pointer: string) {
		const handle = context?.handle;
		if (!handle) return;
		const path: Path = [];
		for (const seg of parseJsonPointer(pointer)) {
			path.push(seg);
			if (typeof seg !== 'number') continue;
			try {
				await ipc.docChildCount(handle, path);
			} catch {
				path[path.length - 1] = String(seg);
			}
		}
		onJump?.(path);
	}

	const noConstraints = $derived.by(() => {
		if (!result || !result.valid) return false;
		const text = schema.text.trim();
		return text.length > 0 && !hasSchemaKeywords(text);
	});

	const schemaKeyRejected = $derived(
		schema.origin?.from === 'document' &&
			(result?.errors.some(
				(e) =>
					e.instancePath === '' &&
					/\/(additional|unevaluated)Properties$/.test(e.schemaPath) &&
					e.message.includes("'$schema'"),
			) ??
				false),
	);

	const statusText = $derived.by(() => {
		if (!context) return 'no document in this tab';
		if (busy) return 'validating…';
		if (problem) return problem;
		if (!schema.text.trim()) return 'paste a schema below';
		if (schema.verdict.kind === 'stale') {
			return result ? 'out of date · press Validate' : 'not validated · press Validate';
		}
		if (result == null) return '';
		if (result.valid) return 'valid · 0 errors';
		const n = result.errorCount;
		return `invalid · ${n} error${n === 1 ? '' : 's'}${result.truncated ? ' (showing 500)' : ''}`;
	});

	const statusKind = $derived.by(() => {
		if (busy) return 'busy';
		if (problem) return 'err';
		if (!result || schema.verdict.kind === 'stale') return 'none';
		return result.valid ? 'ok' : 'err';
	});
</script>

<div class="panel">
	<div class="status" data-kind={statusKind}>
		{#if statusKind === 'ok'}<span class="status-dot ok"></span>
		{:else if statusKind === 'err'}<span class="status-dot err"></span>
		{:else if statusKind === 'busy'}<span class="status-dot busy"></span>
		{:else}<span class="status-dot none"></span>{/if}
		<span class="status-text">{statusText}</span>
	</div>

	{#if schema.origin}
		<div class="origin dim text-xs">
			<div>from {schema.origin.from === 'cli' ? '--schema' : '$schema'} · {schema.origin.ref}</div>
			{#if schema.origin.ignoredDocRef}
				<div>the document's $schema ({schema.origin.ignoredDocRef}) is not used</div>
			{/if}
		</div>
	{/if}

	{#if schemaKeyRejected}
		<div class="notice notice-warn text-xs">
			This schema doesn't allow the document's <code>$schema</code> key. Add
			<code>{'"$schema": { "type": "string" }'}</code> to its <code>properties</code>.
		</div>
	{/if}

	{#if noConstraints}
		<div class="warn notice notice-warn text-xs">
			No JSON Schema keywords found — this accepts <em>any</em> input, so it can't catch type
			mismatches. A JSON Schema uses <code>type</code> / <code>properties</code> /
			<code>required</code>, e.g.
			<code>{'{ "properties": { "version": { "type": "number" } } }'}</code>.
		</div>
	{/if}

	<div class="bar">
		<button
			class="btn"
			class:btn-primary={manual}
			onclick={onValidateNow}
			disabled={!context || !schema.text.trim() || busy}
			title="Validate now">Validate</button
		>
		<button
			class="btn btn-ghost"
			onclick={onClearSchema}
			disabled={!schema.text}
			title="Clear schema">Clear</button
		>
	</div>

	<textarea
		value={schema.text}
		oninput={onSchemaInput}
		placeholder={'{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object",\n  "required": ["id"],\n  "properties": {\n    "id": {"type": "string"}\n  }\n}'}
		spellcheck="false"
		autocomplete="off"
		aria-label="json schema"
	></textarea>

	{#if result && !result.valid}
		<div class="errs">
			<div class="errs-head text-xs">
				{result.errorCount} error{result.errorCount === 1 ? '' : 's'}
				{#if result.truncated}<span class="dim">· showing 500</span>{/if}
			</div>
			<ul class="errs-list">
				{#each result.errors as err, i (i)}
					<li>
						<button
							type="button"
							class="err-row notice"
							onclick={() => void jumpTo(err.instancePath)}
							title={'jump to ' + (err.instancePath || '(root)')}
						>
							<code class="err-path">{err.instancePath || '$'}</code>
							<span class="err-msg">{err.message}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.panel {
		gap: var(--space-sm);
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		color: var(--text-dim);
	}
	.origin {
		overflow-wrap: anywhere;
	}
	.status[data-kind='ok'] .status-text {
		color: var(--success);
	}
	.status[data-kind='err'] .status-text {
		color: var(--danger);
		text-transform: none;
		letter-spacing: 0;
		word-break: break-word;
	}
	.status[data-kind='busy'] .status-text {
		color: var(--warning);
	}
	.status-text {
		flex: 1;
		min-width: 0;
	}

	.warn {
		line-height: 1.5;
	}
	.warn em {
		color: var(--warning);
		font-style: normal;
	}
	.warn code {
		font-family: var(--font-mono);
		color: var(--warning);
		font-size: var(--font-size-xs);
	}

	.bar {
		display: flex;
		gap: var(--space-xs);
	}

	textarea {
		flex: 1;
		min-height: 180px;
		resize: vertical;
		white-space: pre;
	}

	.errs {
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: var(--space-xs);
		border-top: var(--rule-width) solid var(--rule);
		padding-top: var(--space-sm);
	}
	.errs-head {
		color: var(--danger);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}

	.errs-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		overflow-y: auto;
		max-height: 320px;
	}
	.errs-list li {
		list-style: none;
	}
	.err-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2xs);
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: inherit;
		cursor: pointer;
		font: inherit;
		color: inherit;
	}
	.err-row:hover {
		color: var(--text);
	}
	.err-row:hover .err-path {
		color: var(--text);
	}
	.err-row:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.err-path {
		color: var(--text-dim);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}
	.err-msg {
		color: var(--text-dim);
		word-break: break-word;
	}
</style>
