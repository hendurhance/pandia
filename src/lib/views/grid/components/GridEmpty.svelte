<script lang="ts">
	import type { ColumnSchema, NodeKind } from '$lib/ipc/bindings';

	interface Props {
		schema: ColumnSchema;
		rootKind: NodeKind;
		onOpenTree?: () => void;
	}

	let { schema, rootKind, onOpenTree }: Props = $props();

	const copy = $derived.by(() => {
		switch (schema.reason) {
			case 'not-array':
				return {
					headline: "This document isn't a table",
					message: `Grid view shows arrays of objects. This document's root is "${rootKind}".`,
				};
			case 'empty':
				return { headline: 'This array is empty', message: 'This array has no rows.' };
			case 'non-object-elements':
				return {
					headline: "These items aren't objects",
					message: 'Grid view needs an array of objects.',
				};
			case 'too-divergent':
				return {
					headline: "These rows don't share columns",
					message: "These rows don't share enough columns to render as a grid.",
				};
			default:
				return {
					headline: "This can't be shown as a table",
					message: 'Grid view is not available for this document.',
				};
		}
	});
</script>

<div class="empty-state">
	<div class="empty-state-inner">
		<div class="headline">{copy.headline}</div>
		<div class="dim">{copy.message}</div>
		{#if schema.rowCount > 0}
			<div class="dim text-sm">
				inspected {schema.sampled} of {schema.rowCount} rows
			</div>
		{/if}
		{#if onOpenTree && schema.reason !== 'empty'}
			<button class="btn btn-primary open-tree" onclick={onOpenTree}>Open in Tree view</button>
		{/if}
	</div>
</div>

<style>
	.headline {
		color: var(--text);
		font-size: var(--font-size-base);
		font-weight: 700;
	}
	.open-tree {
		align-self: flex-start;
	}
</style>
