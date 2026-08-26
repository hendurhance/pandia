<script lang="ts">
	import type { Diagnosis } from '$lib/ipc/bindings';
	import Icon from '$lib/ui/Icon.svelte';
	import { X } from '@lucide/svelte';

	interface Props {
		diagnosis: Diagnosis;
		busy: boolean;
		onFix: (text: string) => void;
		onDismiss: () => void;
	}

	let { diagnosis, busy, onFix, onDismiss }: Props = $props();

	const before = $derived(
		diagnosis.excerpt ? [...diagnosis.excerpt.text].slice(0, diagnosis.excerpt.caret).join('') : '',
	);
	const at = $derived(
		diagnosis.excerpt ? ([...diagnosis.excerpt.text][diagnosis.excerpt.caret] ?? '') : '',
	);
	const after = $derived(
		diagnosis.excerpt
			? [...diagnosis.excerpt.text].slice(diagnosis.excerpt.caret + 1).join('')
			: '',
	);
</script>

<div class="diag" role="alert">
	<div class="head">
		<span class="title">{diagnosis.title}</span>
		<button class="dismiss" onclick={onDismiss} aria-label="dismiss"
			><Icon icon={X} size="sm" /></button
		>
	</div>

	<p class="detail">{diagnosis.detail}</p>

	{#if diagnosis.excerpt}
		{@const ex = diagnosis.excerpt}
		<div class="excerpt" aria-label="line {ex.line}, column {ex.column}">
			<code class="code"
				>{#if ex.clippedStart}<span class="clip">…</span>{/if}<span class="ok">{before}</span><span
					class="hit">{at}</span
				><span class="ok">{after}</span>{#if ex.clippedEnd}<span class="clip">…</span>{/if}</code
			>
			<span class="where">line {ex.line}, column {ex.column}</span>
		</div>
	{/if}

	{#if diagnosis.fix}
		{@const fix = diagnosis.fix}
		<div class="actions">
			<button class="fix" onclick={() => onFix(fix.text)} disabled={busy}>{fix.label}</button>
			{#if fix.warnings.length > 0}
				<span class="warn"
					>changes {fix.warnings.length} thing{fix.warnings.length > 1 ? 's' : ''}</span
				>
			{/if}
		</div>
		{#if fix.warnings.length > 0}
			<ul class="warn-list">
				{#each fix.warnings.slice(0, 4) as w, i (i)}
					<li>{w}</li>
				{/each}
				{#if fix.warnings.length > 4}
					<li class="more">+{fix.warnings.length - 4} more</li>
				{/if}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.diag {
		/* --danger has no soft/line companions in tokens.css; derived here
		   rather than adding globals for a single component. */
		--diag-soft: rgba(229, 72, 77, 0.1);
		--diag-line: rgba(229, 72, 77, 0.45);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--diag-line);
		background: var(--diag-soft);
		border-radius: 4px;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.title {
		font-weight: 600;
		color: var(--danger);
	}
	.dismiss {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-faint);
		cursor: pointer;
		flex: none;
	}
	.dismiss:hover {
		color: var(--text);
	}

	.detail {
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-dim);
	}

	.excerpt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.4rem 0.5rem;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 3px;
		overflow-x: auto;
	}
	.code {
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre;
	}
	.ok {
		color: var(--text-dim);
	}
	/* Marked rather than caret-under-text: it survives wrapping and scrolling,
	   and screen readers get the position from the aria-label instead. */
	.hit {
		color: var(--danger);
		background: var(--diag-soft);
		outline: 1px solid var(--diag-line);
		border-radius: 2px;
	}
	.clip {
		color: var(--text-faint);
	}
	.where {
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding-top: 0.1rem;
	}
	.fix {
		padding: 3px 10px;
		font-size: 12px;
		border: 1px solid var(--accent-line);
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 3px;
		cursor: pointer;
	}
	.fix:hover:not(:disabled) {
		background: var(--accent);
		color: var(--bg);
	}
	.fix:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.warn {
		font-size: 11px;
		color: var(--text-faint);
	}
	.warn-list {
		margin: 0;
		padding-left: 1rem;
		font-size: 11px;
		color: var(--text-faint);
	}
	.more {
		list-style: none;
		margin-left: -1rem;
	}
</style>
