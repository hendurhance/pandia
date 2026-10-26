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
			<button class="btn btn-primary" onclick={() => onFix(fix.text)} disabled={busy}
				>{fix.label}</button
			>
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
		/* --danger has no line companion in tokens.css; derived here
		   rather than adding a global for a single component. */
		--diag-soft: var(--danger-soft);
		--diag-line: rgba(229, 72, 77, 0.45);
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-sm);
		border: 1px solid var(--diag-line);
		background: var(--diag-soft);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-sm);
	}
	.title {
		font-weight: 700;
		color: var(--danger);
	}
	.dismiss {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-dim);
		cursor: pointer;
		flex: none;
	}
	.dismiss:hover {
		color: var(--text);
	}

	.detail {
		margin: 0;
		font-size: var(--font-size-sm);
		line-height: 1.45;
		color: var(--text-dim);
	}

	.excerpt {
		display: flex;
		flex-direction: column;
		gap: var(--space-2xs);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg);
		border: 1px solid var(--rule);
		overflow-x: auto;
	}
	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
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
	}
	.clip {
		color: var(--text-faint);
	}
	.where {
		font-size: var(--font-size-xs);
		letter-spacing: var(--label-tracking);
		text-transform: uppercase;
		color: var(--text-dim);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding-top: var(--space-2xs);
	}
	.warn {
		font-size: var(--font-size-sm);
		color: var(--text-dim);
	}
	.warn-list {
		margin: 0;
		padding-left: 1rem;
		font-size: var(--font-size-sm);
		color: var(--text-dim);
	}
	.more {
		list-style: none;
		margin-left: -1rem;
	}
</style>
