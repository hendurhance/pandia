<script lang="ts">
	import type { ColumnSchema, NodeKind } from '$lib/ipc/types';

	interface Props {
		schema: ColumnSchema;
		rootKind: NodeKind;
	}

	let { schema, rootKind }: Props = $props();

	const message = $derived.by(() => {
		switch (schema.reason) {
			case 'not-array':
				return `Grid view shows arrays of objects. This document's root is "${rootKind}".`;
			case 'empty':
				return 'This array has no rows.';
			case 'non-object-elements':
				return 'Grid view needs an array of objects.';
			case 'too-divergent':
				return "These rows don't share enough columns to render as a grid.";
			default:
				return 'Grid view is not available for this document.';
		}
	});
</script>

<div class="empty-state">
	<div class="empty-state-inner">
		<div class="label">grid not available</div>
		<div>{message}</div>
		{#if schema.rowCount > 0}
			<div class="dim text-sm">
				inspected {schema.sampled} of {schema.rowCount} rows
			</div>
		{/if}
	</div>
</div>

<style>
	
	.label {
		color: var(--text-dim);
		font-size: 11.5px;
		letter-spacing: var(--label-tracking);
		text-transform: uppercase;
	}
</style>
