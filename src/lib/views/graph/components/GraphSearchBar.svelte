<script lang="ts">
	import SearchField from '$lib/ui/SearchField.svelte';

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

	let {
		open,
		query,
		counter,
		navDisabled,
		isError,
		onQueryChange,
		onPrev,
		onNext,
		onClose,
	}: Props = $props();
</script>

{#if open}
	<div class="find" role="dialog" aria-label="find a node in the graph">
		<SearchField
			{open}
			{query}
			{counter}
			{navDisabled}
			{isError}
			placeholder="find a node…"
			inputLabel="graph search query"
			{onQueryChange}
			{onPrev}
			{onNext}
			{onClose}
		/>
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
		gap: var(--space-2xs);
		padding: var(--space-xs);
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		box-shadow: var(--shadow-pop);
		min-width: 320px;
		max-width: 420px;
		font-size: var(--font-size-sm);
	}
</style>
