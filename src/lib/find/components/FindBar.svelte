<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import SearchField from '$lib/ui/SearchField.svelte';
	interface Props {
		open: boolean;
		query: string;

		counter: string;

		navDisabled: boolean;

		isError: boolean;

		busy?: boolean;
		onQueryChange: (q: string) => void;
		onPrev: () => void;
		onNext: () => void;
		onClose: () => void;

		onCancel?: () => void;
		replaceValue: string;
		onReplaceChange: (v: string) => void;
		onReplaceAll: () => void;
		replaceStatus: string | null;
	}

	let {
		open,
		query,
		counter,
		navDisabled,
		isError,
		busy = false,
		onQueryChange,
		onPrev,
		onNext,
		onClose,
		onCancel,
		replaceValue,
		onReplaceChange,
		onReplaceAll,
		replaceStatus,
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let replaceOpen = $state(replaceValue.length > 0);

	function onReplaceInput(e: Event) {
		onReplaceChange((e.target as HTMLInputElement).value);
	}

	function onReplaceKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (query) onReplaceAll();
		}
	}

	function toggleReplace() {
		replaceOpen = !replaceOpen;
	}
</script>

{#if open}
	<div class="find" role="dialog" aria-label="find and replace in document">
		<button
			class="expander"
			onclick={toggleReplace}
			aria-expanded={replaceOpen}
			aria-label={replaceOpen ? 'hide replace' : 'show replace'}
			title={replaceOpen ? 'hide replace' : 'show replace'}
		>
			<span class="chev" class:open={replaceOpen}
				><Icon icon={replaceOpen ? ChevronDown : ChevronRight} size="xs" /></span
			>
		</button>
		<div class="cols">
			<div class="row">
				<SearchField
					{open}
					{query}
					{counter}
					{navDisabled}
					{isError}
					{busy}
					placeholder="find in document"
					inputLabel="search query"
					closeLabel="Close find"
					{onQueryChange}
					{onPrev}
					{onNext}
					{onClose}
					{onCancel}
				/>
			</div>

			{#if replaceOpen}
				<div class="row replace">
					<div class="field">
						<input
							value={replaceValue}
							oninput={onReplaceInput}
							onkeydown={onReplaceKeydown}
							placeholder="Replace with"
							spellcheck="false"
							autocomplete="off"
							aria-label="Replacement text"
						/>
						{#if replaceStatus}
							<span class="counter">{replaceStatus}</span>
						{/if}
					</div>
					<div class="actions">
						<button
							class="repl"
							onclick={onReplaceAll}
							disabled={!query}
							title="Replace all matches · ↵"
							aria-label="Replace all">Replace all</button
						>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.find {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 40;
		display: flex;
		align-items: flex-start;
		gap: 2px;
		padding: 4px;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		box-shadow:
			0 1px 0 rgba(0, 0, 0, 0.4),
			0 8px 24px rgba(0, 0, 0, 0.35);
		min-width: 380px;
		max-width: 480px;
		font-size: var(--font-size-sm);
	}

	.expander {
		flex-shrink: 0;
		background: transparent;
		border: none;
		width: 18px;
		min-height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0;
		align-self: stretch;
	}
	.expander:hover {
		color: var(--accent);
	}
	.expander:focus-visible {
		outline: none;
		color: var(--accent);
	}
	.chev {
		display: inline-block;
		font-size: 10px;
		transition: transform 120ms ease;
	}
	.chev.open {
		transform: rotate(90deg);
	}

	.cols {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
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

	.actions {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		flex-shrink: 0;
	}

	.repl {
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		padding: 0 10px;
		height: 26px;
		font-size: var(--font-size-xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-dim);
		cursor: pointer;
		white-space: nowrap;
	}
	.repl:hover:not(:disabled) {
		color: var(--text);
		background: var(--bg-elev-2);
		border-color: var(--rule-2);
	}
	.repl:focus-visible {
		outline: none;
		color: var(--accent);
		border-color: var(--accent);
	}
	.repl:disabled {
		color: var(--text-ghost);
		cursor: default;
		border-color: var(--rule);
	}
</style>
