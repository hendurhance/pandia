<script lang="ts">
	import Dialog from './Dialog.svelte';
	import type { ConfirmChoice } from './confirm.svelte';

	interface Props {
		title: string;
		message: string;
		primaryLabel: string;
		secondaryLabel: string;
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

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			onPick('primary');
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<Dialog onClose={() => onPick('cancel')}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
		<div class="title" id="confirm-title">{title}</div>
		<div class="dim text-sm">{message}</div>
		<div class="actions">
			<button class="btn" onclick={() => onPick('cancel')}>{cancelLabel}<span class="hint">esc</span></button>
			<button class="btn" onclick={() => onPick('secondary')}>{secondaryLabel}</button>
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
		gap: 0.7rem;
		padding: 0.9rem 1rem;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
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
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	.hint {
		color: var(--text-faint);
		margin-left: 0.4rem;
	}
	.btn-primary .hint {
		color: var(--bg);
		opacity: 0.6;
	}
	.btn-primary:hover .hint {
		color: var(--accent);
	}
	.btn-danger {
		background: var(--danger, var(--accent));
		border-color: var(--danger, var(--accent));
		color: var(--bg);
	}
	.btn-danger:hover {
		background: var(--danger-hover, var(--accent-line));
		border-color: var(--danger-hover, var(--accent-line));
	}
</style>
