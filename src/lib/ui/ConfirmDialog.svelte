<script lang="ts">
	import Dialog from './Dialog.svelte';
	import type { ConfirmChoice } from './confirm.svelte';

	interface Props {
		title: string;
		message: string;
		primaryLabel: string;
		secondaryLabel?: string;
		cancelLabel?: string;
		dangerPrimary?: boolean;
		onPick: (choice: ConfirmChoice) => void;
	}

	let {
		title,
		message,
		primaryLabel,
		secondaryLabel,
		cancelLabel = 'cancel',
		dangerPrimary = false,
		onPick,
	}: Props = $props();

	let primaryBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		const t = setTimeout(() => primaryBtn?.focus(), 0);
		return () => clearTimeout(t);
	});
</script>

<Dialog onClose={() => onPick('cancel')}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
		<div class="title" id="confirm-title">{title}</div>
		<div class="dim text-sm">{message}</div>
		<div class="actions">
			<button class="btn" onclick={() => onPick('cancel')}
				>{cancelLabel}<span class="hint">esc</span></button
			>
			{#if secondaryLabel}
				<button class="btn" onclick={() => onPick('secondary')}>{secondaryLabel}</button>
			{/if}
			<button
				bind:this={primaryBtn}
				class="btn btn-primary"
				class:btn-danger={dangerPrimary}
				onclick={() => onPick('primary')}>{primaryLabel}<span class="hint">↵</span></button
			>
		</div>
	</div>
</Dialog>

<style>
	.sheet {
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		min-width: 380px;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-md);
		box-shadow: var(--shadow-modal);
	}
	.title {
		color: var(--text);
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-xs);
		margin-top: var(--space-2xs);
	}
	.hint {
		color: var(--text-dim);
		margin-left: var(--space-xs);
	}
	.btn-primary .hint {
		color: var(--on-accent);
		opacity: 0.6;
	}
	.btn-danger {
		background: var(--danger, var(--accent));
		border-color: var(--danger, var(--accent));
		color: var(--bg);
	}
	.btn-danger:hover {
		background: var(--danger-hover);
		border-color: var(--danger-hover);
		color: var(--bg);
	}
	.btn-danger .hint {
		color: var(--bg);
	}
</style>
