<script lang="ts">
	import { docValidateSchema } from '$lib/ipc/doc';
	import type { DocHandle, Path } from '$lib/ipc/types';
	import { schemaStore } from './state/schema-store.svelte';
	import { hasSchemaKeywords } from './schema-keywords';
	import { parseJsonPointer } from '$lib/util/path';
	import {
		behaviorPrefs,
		SCHEMA_DEBOUNCE_IMMEDIATE,
		SCHEMA_DEBOUNCE_MANUAL,
	} from '$lib/settings/state/behavior-prefs.svelte';

	interface Context {
		handle: DocHandle;
		version: number;
		sourceName: string | null;
	}

	interface Props {
		tabId: string;
		context: Context | null;
		
		onJump?: (path: Path) => void;
	}

	let { tabId, context, onJump }: Props = $props();

	$effect(() => {
		void behaviorPrefs.init();
	});

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let seq = 0;

	const state = $derived(schemaStore.get(tabId));

	function onSchemaInput(e: Event) {
		const t = (e.target as HTMLTextAreaElement).value;
		schemaStore.setText(tabId, t);
		scheduleValidate();
	}

	function scheduleValidate() {
		if (debounceTimer != null) clearTimeout(debounceTimer);
		const text = schemaStore.get(tabId).text.trim();
		if (!text || !context) {
			schemaStore.setResult(tabId, null, null, null);
			return;
		}
		const ms = behaviorPrefs.schemaDebounceMs;
		if (ms === SCHEMA_DEBOUNCE_MANUAL) return;
		schemaStore.setBusy(tabId, true);
		if (ms === SCHEMA_DEBOUNCE_IMMEDIATE) {
			void runValidate();
			return;
		}
		debounceTimer = setTimeout(() => {
			void runValidate();
		}, ms);
	}

	async function runValidate() {
		if (!context) return;
		const text = schemaStore.get(tabId).text.trim();
		if (!text) return;
		const mySeq = ++seq;
		const versionAtValidate = context.version;
		try {
			const result = await docValidateSchema(context.handle, text);
			if (mySeq !== seq) return; // newer request started
			schemaStore.setResult(tabId, result, null, versionAtValidate);
		} catch (e) {
			if (mySeq !== seq) return;
			schemaStore.setResult(tabId, null, String(e), null);
		}
	}

	function onValidateNow() {
		if (debounceTimer != null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		void runValidate();
	}

	function onClearSchema() {
		schemaStore.setText(tabId, '');
		schemaStore.setResult(tabId, null, null, null);
		if (debounceTimer != null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}

	let lastVersion: number | null = null;
	$effect(() => {
		const v = context?.version ?? null;
		if (v == null) {
			lastVersion = null;
			return;
		}
		if (lastVersion !== v) {
			lastVersion = v;
			if (state.text.trim() && state.result !== null) {
				scheduleValidate();
			}
		}
	});

	const noConstraints = $derived.by(() => {
		if (!state.result || !state.result.valid) return false;
		const text = state.text.trim();
		return text.length > 0 && !hasSchemaKeywords(text);
	});

	const statusText = $derived.by(() => {
		if (!context) return 'no document in this tab';
		if (state.busy) return 'validating…';
		if (state.error) return state.error;
		if (state.result == null) return state.text.trim() ? '' : 'paste a schema below';
		if (state.result.valid) return 'valid · 0 errors';
		const n = state.result.errorCount;
		return `invalid · ${n} error${n === 1 ? '' : 's'}${state.result.truncated ? ' (showing 500)' : ''}`;
	});

	const statusKind = $derived.by(() => {
		if (state.busy) return 'busy';
		if (state.error) return 'err';
		if (!state.result) return 'none';
		return state.result.valid ? 'ok' : 'err';
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
			onclick={onValidateNow}
			disabled={!context || !state.text.trim() || state.busy}
			title="Validate now">Validate</button
		>
		<button
			class="btn btn-ghost"
			onclick={onClearSchema}
			disabled={!state.text}
			title="Clear schema">Clear</button
		>
	</div>

	<textarea
		value={state.text}
		oninput={onSchemaInput}
		placeholder={'{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object",\n  "required": ["id"],\n  "properties": {\n    "id": {"type": "string"}\n  }\n}'}
		spellcheck="false"
		autocomplete="off"
		aria-label="json schema"
	></textarea>

	{#if state.result && !state.result.valid}
		<div class="errs">
			<div class="errs-head text-xs">
				{state.result.errorCount} error{state.result.errorCount === 1 ? '' : 's'}
				{#if state.result.truncated}<span class="dim">· showing 500</span>{/if}
			</div>
			<ul class="errs-list">
				{#each state.result.errors as err, i (i)}
					<li>
						<button
							type="button"
							class="err-row notice"
							onclick={() => onJump?.(parseJsonPointer(err.instancePath))}
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
		gap: 0.6rem;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		color: var(--text-faint);
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
		font-size: 10px;
	}

	.bar {
		display: flex;
		gap: 0.4rem;
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
		gap: 0.3rem;
		border-top: var(--rule-width) solid var(--rule);
		padding-top: 0.5rem;
	}
	.errs-head {
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}

	.errs-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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
		gap: 0.1rem;
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
		color: var(--accent);
	}
	.err-row:hover .err-path {
		color: var(--accent);
	}
	.err-row:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.err-path {
		color: var(--accent-2);
		font-family: var(--font-mono);
		font-size: 10px;
	}
	.err-msg {
		color: var(--text-dim);
		word-break: break-word;
	}
</style>
