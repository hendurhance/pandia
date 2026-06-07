<script lang="ts">
	import type { DocHandle } from '$lib/ipc/types';
	import type { CompareTarget } from '$lib/views/compare/logic/compare-target';
	import { dismissable } from '$lib/ui/dismissable';

	interface Candidate {
		id: string;
		label: string;
		ctx: { handle: DocHandle; sourceName: string | null };
	}

	let {
		candidates,
		anchorEl,
		onPick,
		onDismiss,
	}: {
		candidates: Candidate[];

		anchorEl: HTMLElement | null;
		onPick: (target: CompareTarget) => void;
		onDismiss: () => void;
	} = $props();
</script>

<div
	class="cmp-pop menu"
	role="menu"
	aria-label="compare against"
	use:dismissable={{ onDismiss, ignore: anchorEl }}
>
	<div class="menu-head">compare against</div>
	{#if candidates.length > 0}
		{#each candidates as c (c.id)}
			<button
				class="menu-item"
				role="menuitem"
				onclick={() => onPick({ kind: 'tab', handle: c.ctx.handle, sourceName: c.ctx.sourceName })}
				title={c.ctx.sourceName ?? c.label}
			>
				<span class="status-dot busy" aria-hidden="true"></span>
				<span class="cmp-label">{c.label}</span>
			</button>
		{/each}
	{:else}
		<div class="cmp-empty">No other open documents</div>
	{/if}
	<div class="menu-divider"></div>
	<button class="menu-item file" role="menuitem" onclick={() => onPick({ kind: 'file' })}>
		<span class="cmp-label">Open a file…</span>
	</button>
</div>

<style>
	.cmp-pop {
		position: absolute;
		top: var(--tab-h);
		right: 0;
		z-index: 91;
		min-width: 220px;
		max-width: 320px;
		max-height: 60vh;
		overflow-y: auto;
	}

	.menu-item:hover {
		color: var(--accent);
	}
	.menu-item.file {
		color: var(--text-dim);
	}
	.cmp-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cmp-empty {
		padding: 0.5rem 0.7rem;
		color: var(--text-faint);
		font-size: var(--font-size-sm);
	}
</style>
