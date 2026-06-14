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
</style>
