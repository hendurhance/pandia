<script lang="ts">
	import type { Path, PathSegment } from '$lib/ipc/types';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronRight, FoldVertical, Search, UnfoldVertical } from '@lucide/svelte';

	interface Props {
		path: Path | null;
		onSegment: (depth: number) => void;
		onExpandAll: () => void;
		onCollapseAll: () => void;
		expandAllDisabled: boolean;
		expandAllTitle: string;
		onSearch?: () => void;
		editing?: boolean;
	}

	let {
		path,
		onSegment,
		onExpandAll,
		onCollapseAll,
		expandAllDisabled,
		expandAllTitle,
		onSearch,
		editing = false,
	}: Props = $props();

	function renderSeg(seg: PathSegment): string {
		if (typeof seg === 'number') return `[${seg}]`;
		return String(seg);
	}
</script>

<div class="bar">
	{#if editing}<span class="editing-dot" title="Editing" aria-label="Editing"></span>{/if}
	<span class="toggle" aria-hidden="true"><Icon icon={ChevronRight} size="xs" /></span>
	<div class="path">
		<button
			class="seg crumb root"
			class:last={!path || path.length === 0}
			onclick={() => onSegment(-1)}>$</button
		>
		{#if path}
			{#each path as seg, i (i)}
				<span class="sep" aria-hidden="true"><Icon icon={ChevronRight} size="xs" /></span>
				<button
					class="seg crumb"
					class:idx={typeof seg === 'number'}
					class:last={i === path.length - 1}
					onclick={() => onSegment(i)}>{renderSeg(seg)}</button
				>
			{/each}
		{/if}
	</div>
	<div class="grow"></div>
	<div class="actions">
		<span class="tip" title={expandAllTitle}>
			<button class="icon" onclick={onExpandAll} disabled={expandAllDisabled}
				><Icon icon={UnfoldVertical} size="xs" /> Expand all</button
			>
		</span>
		<button class="icon" onclick={onCollapseAll}
			><Icon icon={FoldVertical} size="xs" /> Collapse all</button
		>
		<button
			class="icon"
			onclick={onSearch}
			disabled={!onSearch}
			title={onSearch ? 'Search (⌘F)' : 'Search unavailable'}
			><Icon icon={Search} size="xs" /> Search</button
		>
	</div>
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 16px;
		background: var(--bg);
		border-bottom: var(--rule-width) solid var(--rule);
		font-size: 11.5px;
		color: var(--text-dim);
		flex-shrink: 0;
	}
	.toggle {
		color: var(--text-faint);
		flex-shrink: 0;
	}

	.editing-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		background: var(--accent);
		flex-shrink: 0;
		animation: bc-pulse 1.4s ease-in-out infinite;
	}
	@keyframes bc-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.path {
		display: flex;
		gap: 0.2rem;
		align-items: center;
		min-width: 0;
		overflow: hidden;
	}

	.seg {
		background: transparent;
		border: none;
		padding: 0 2px;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: 11.5px;
	}
	.seg:hover {
		color: var(--accent);
	}
	.seg.idx {
		color: var(--text-dim);
	}
	.seg.idx:hover {
		color: var(--accent);
	}
	.seg.last {
		color: var(--accent);
	}
	.seg.root.last {
		color: var(--accent);
	}
	.sep {
		color: var(--text-faint);
		padding: 0 2px;
	}

	.actions {
		display: flex;
		gap: 12px;
		flex-shrink: 0;
		align-items: center;
		color: var(--text-faint);
	}
	.actions .tip {
		display: inline-flex;
	}
	.actions .icon {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		padding: 0;
		font-size: 10.5px;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		cursor: pointer;
		white-space: nowrap;
	}
	.actions .icon:hover {
		color: var(--text);
	}
	.actions .icon:disabled {
		color: var(--text-ghost);
		cursor: default;
	}
</style>
