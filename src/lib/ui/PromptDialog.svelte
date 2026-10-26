<script lang="ts">
	import Dialog from './Dialog.svelte';

	interface Props {
		message: string;
		defaultValue?: string;
		onCommit: (value: string) => void;
		onCancel: () => void;
	}

	let { message, defaultValue = '', onCommit, onCancel }: Props = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(defaultValue);
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		const t = setTimeout(() => {
			inputEl?.focus();
			inputEl?.select();
		}, 0);
		return () => clearTimeout(t);
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			onCommit(value);
		}
	}
</script>

<Dialog onClose={onCancel}>
	<div class="sheet" role="dialog" aria-modal="true">
		<div class="dim text-sm">{message}</div>
		<input
			bind:this={inputEl}
			bind:value
			onkeydown={onKeydown}
			spellcheck="false"
			autocomplete="off"
		/>
		<div class="actions">
			<button class="btn" onclick={onCancel}>Cancel <span class="hint">esc</span></button>
			<button class="btn btn-primary" onclick={() => onCommit(value)}
				>OK <span class="hint">↵</span></button
			>
		</div>
	</div>
</Dialog>

<style>
	.sheet {
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		min-width: 360px;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-md);
		box-shadow: var(--shadow-modal);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-xs);
	}

	.hint {
		color: var(--text-dim);
		margin-left: var(--space-xs);
	}
	.btn-primary .hint {
		color: var(--on-accent);
		opacity: 0.6;
	}
</style>
