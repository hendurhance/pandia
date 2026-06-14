<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { Ban, ChevronDown, ChevronUp, X } from '@lucide/svelte';

	interface Props {
		open: boolean;
		query: string;
		counter: string;
		navDisabled: boolean;
		isError: boolean;
		placeholder: string;
		inputLabel: string;
		closeLabel?: string;
		busy?: boolean;
		onQueryChange: (q: string) => void;
		onPrev: () => void;
		onNext: () => void;
		onClose: () => void;
		onCancel?: () => void;
	}

	let {
		open,
		query,
		counter,
		navDisabled,
		isError,
		placeholder,
		inputLabel,
		closeLabel = 'Close',
		busy = false,
		onQueryChange,
		onPrev,
		onNext,
		onClose,
		onCancel,
	}: Props = $props();

	let inputEl: HTMLInputElement | undefined = $state();

	// Focus + select the query input whenever the bar opens.
	$effect(() => {
		if (open) {
			queueMicrotask(() => {
				inputEl?.focus();
				inputEl?.select();
			});
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) onPrev();
			else onNext();
		}
	}

	function onInput(e: Event) {
		onQueryChange((e.target as HTMLInputElement).value);
	}
</script>

<div class="sf-field" class:err={isError}>
	<input
		bind:this={inputEl}
		value={query}
		oninput={onInput}
		onkeydown={onKeydown}
		{placeholder}
		spellcheck="false"
		autocomplete="off"
		aria-label={inputLabel}
	/>
	{#if counter}
		<span class="sf-counter" class:err={isError}>{counter}</span>
	{/if}
</div>
<div class="sf-actions">
	{#if busy && onCancel}
		<button class="sf-ic cancel" onclick={onCancel} title="Cancel · esc" aria-label="Cancel"
			><Icon icon={Ban} size="sm" /></button
		>
	{:else}
		<button
			class="sf-ic"
			onclick={onPrev}
			disabled={navDisabled}
			title="Previous match · ⇧↵"
			aria-label="Previous match"><Icon icon={ChevronUp} size="sm" /></button
		>
		<button
			class="sf-ic"
			onclick={onNext}
			disabled={navDisabled}
			title="Next match · ↵"
			aria-label="Next match"><Icon icon={ChevronDown} size="sm" /></button
		>
	{/if}
	<span class="sf-sep" aria-hidden="true"></span>
	<button class="sf-ic close" onclick={onClose} title="Close · esc" aria-label={closeLabel}
		><Icon icon={X} size="sm" /></button
	>
</div>

<style>
	.sf-field {
		flex: 1;
		display: flex;
		align-items: center;
		min-width: 0;
		background: var(--bg);
		border: var(--rule-width) solid var(--rule);
		padding: 0 6px;
		height: 26px;
		transition: border-color 80ms linear;
	}
	.sf-field:focus-within {
		border-color: var(--accent);
	}
	.sf-field.err {
		border-color: var(--danger);
	}
	.sf-field input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--text);
		outline: none;
	}
	.sf-field input::placeholder {
		color: var(--text-faint);
	}
	.sf-counter {
		flex-shrink: 0;
		margin-left: 8px;
		font-size: 10px;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		white-space: nowrap;
	}
	.sf-counter.err {
		color: var(--danger);
	}
	.sf-actions {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		flex-shrink: 0;
	}
	.sf-ic {
		background: transparent;
		border: none;
		width: 26px;
		height: 26px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-dim);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
		padding: 0;
	}
	.sf-ic:hover:not(:disabled) {
		color: var(--text);
		background: var(--bg-elev-2);
	}
	.sf-ic:focus-visible {
		outline: none;
		color: var(--accent);
		background: var(--bg-elev-2);
	}
	.sf-ic:disabled {
		color: var(--text-ghost);
		cursor: default;
	}
	.sf-ic.close {
		font-size: 16px;
	}
	.sf-ic.cancel {
		font-size: 13px;
		color: var(--accent);
	}
	.sf-ic.cancel:hover {
		color: var(--text);
		background: var(--accent-soft);
	}
	.sf-sep {
		display: inline-block;
		width: 1px;
		height: 16px;
		background: var(--rule);
		margin: 0 2px;
		align-self: center;
	}
</style>
