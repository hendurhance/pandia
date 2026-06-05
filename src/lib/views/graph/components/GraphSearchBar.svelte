<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';

	interface Props {
		open: boolean;
		query: string;
		
		counter: string;
		
		navDisabled: boolean;
		
		isError: boolean;
		onQueryChange: (q: string) => void;
		onPrev: () => void;
		onNext: () => void;
		onClose: () => void;
	}

	let { open, query, counter, navDisabled, isError, onQueryChange, onPrev, onNext, onClose }: Props =
		$props();

	let inputEl: HTMLInputElement | undefined = $state();

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

{#if open}
	<div class="find" role="dialog" aria-label="find a node in the graph">
		<div class="field" class:err={isError}>
			<input
				bind:this={inputEl}
				value={query}
				oninput={onInput}
				onkeydown={onKeydown}
				placeholder="find a node…"
				spellcheck="false"
				autocomplete="off"
				aria-label="graph search query"
			/>
			{#if counter}
				<span class="counter" class:err={isError}>{counter}</span>
			{/if}
		</div>
		<div class="actions">
			<button
				class="ic"
				onclick={onPrev}
				disabled={navDisabled}
				title="Previous match · ⇧↵"
				aria-label="Previous match"><Icon icon={ChevronUp} size="sm" /></button
			>
			<button
				class="ic"
				onclick={onNext}
				disabled={navDisabled}
				title="Next match · ↵"
				aria-label="Next match"><Icon icon={ChevronDown} size="sm" /></button
			>
			<span class="sep" aria-hidden="true"></span>
			<button class="ic close" onclick={onClose} title="Close · esc" aria-label="Close"
				><Icon icon={X} size="sm" /></button
			>
		</div>
	</div>
{/if}

<style>
	.find {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 3;
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding: 4px;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		box-shadow:
			0 1px 0 rgba(0, 0, 0, 0.4),
			0 8px 24px rgba(0, 0, 0, 0.35);
		min-width: 320px;
		max-width: 420px;
		font-size: var(--font-size-sm);
	}
	.field {
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
	.field:focus-within {
		border-color: var(--accent);
	}
	.field.err {
		border-color: var(--danger);
	}
	.field input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--text);
		outline: none;
	}
	.field input::placeholder {
		color: var(--text-faint);
	}
	.counter {
		flex-shrink: 0;
		margin-left: 8px;
		font-size: 10px;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		white-space: nowrap;
	}
	.counter.err {
		color: var(--danger);
	}
	.actions {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		flex-shrink: 0;
	}
	.ic {
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
	.ic:hover:not(:disabled) {
		color: var(--text);
		background: var(--bg-elev-2);
	}
	.ic:focus-visible {
		outline: none;
		color: var(--accent);
		background: var(--bg-elev-2);
	}
	.ic:disabled {
		color: var(--text-ghost);
		cursor: default;
	}
	.ic.close {
		font-size: 16px;
	}
	.sep {
		display: inline-block;
		width: 1px;
		height: 16px;
		background: var(--rule);
		margin: 0 2px;
		align-self: center;
	}
</style>
