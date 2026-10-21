<script lang="ts">
	import ExternalLink from '$lib/ui/ExternalLink.svelte';
	import { inlineSegments, type ReleaseGroup } from '$lib/shell/logic/release-notes';

	let { groups }: { groups: readonly ReleaseGroup[] } = $props();
</script>

{#snippet inline(text: string)}
	{#each inlineSegments(text) as seg, i (i)}
		{#if seg.kind === 'code'}
			<code>{seg.text}</code>
		{:else if seg.kind === 'link'}
			<ExternalLink href={seg.href}>{seg.text}</ExternalLink>
		{:else}
			{seg.text}
		{/if}
	{/each}
{/snippet}

<!-- Index keys: update notes are untrusted text and may repeat a label or title. -->
{#each groups as g, gi (gi)}
	<div class="grp-title">{g.label}</div>
	{#each g.items as it, i (i)}
		<div class="item">
			<div class="item-title">{@render inline(it.title)}</div>
			{#if it.detail}
				<div class="item-detail">{@render inline(it.detail)}</div>
			{/if}
		</div>
	{/each}
{/each}

<style>
	.grp-title {
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		padding-bottom: var(--space-xs);
		margin: var(--space-md) 0 var(--space-sm);
		border-bottom: var(--rule-width) solid var(--rule);
	}
	.item {
		margin-bottom: var(--space-sm);
		font-family: var(--font-sans);
		font-size: var(--font-size-base);
		line-height: var(--line-height);
	}
	.item-title {
		font-weight: 600;
		color: var(--text);
	}
	.item-detail {
		color: var(--text-dim);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		color: var(--text);
		background: var(--bg);
		border: var(--rule-width) solid var(--rule);
		padding: 0 var(--space-xs);
	}
</style>
