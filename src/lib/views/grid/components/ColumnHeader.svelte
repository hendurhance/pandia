<script lang="ts">
	import type { Column } from '$lib/ipc/types';
	import { resizable } from '$lib/ui/resizable';
	import Icon from '$lib/ui/Icon.svelte';
	import { ArrowDown, ArrowUp, CircleSlash, Filter, Shuffle } from '@lucide/svelte';

	interface Props {
		col: Column;
		
		left: number;
		width: number;
		
		active: boolean;
		
		sortDesc: boolean;
		
		hasFilter: boolean;
		
		dragging: boolean;
		onClick: () => void;
		onPointerDown: (e: PointerEvent) => void;
		onPointerMove: (e: PointerEvent) => void;
		onPointerUp: (e: PointerEvent) => void;
		onPointerCancel: () => void;
		onOpenFilter: (e: MouseEvent) => void;
		
		onResizeStart: () => void;
		onResizeMove: (dx: number) => void;
		
		onResizeEnd: (moved: boolean) => void;
		onAutoFit: () => void;
	}

	let {
		col,
		left,
		width,
		active,
		sortDesc,
		hasFilter,
		dragging,
		onClick,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onOpenFilter,
		onResizeStart,
		onResizeMove,
		onResizeEnd,
		onAutoFit,
	}: Props = $props();
</script>

<div
	class="cell head"
	class:active
	class:dragging
	role="button"
	tabindex="0"
	style="left: {left}px; width: {width}px;"
	title={`${col.key} · ${col.dominantKind}${col.kinds.length > 1 ? ' (mixed)' : ''} · ${(col.presence * 100).toFixed(0)}% — click to sort · drag to reorder · drag edge to resize`}
	onclick={onClick}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerCancel}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onClick();
		}
	}}
>
	<span class="head-key">{col.key}</span>
	{#if col.kinds.length > 1}
		<span class="mark mixed" title="Mixed types"><Icon icon={Shuffle} size="xs" /></span>
	{/if}
	{#if col.nullable}
		<span class="mark nullable" title="Contains null"><Icon icon={CircleSlash} size="xs" /></span>
	{/if}
	{#if active}
		<span class="sort-arrow"><Icon icon={sortDesc ? ArrowDown : ArrowUp} size="xs" /></span>
	{:else}
		<span class="sort-arrow hint"><Icon icon={ArrowUp} size="xs" /></span>
	{/if}
	<button
		class="funnel"
		class:on={hasFilter}
		title="Filter this column"
		aria-label="Filter {col.key}"
		onclick={onOpenFilter}
	>
		<Icon icon={Filter} size="xs" />
	</button>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		class="col-resize"
		title="Drag to resize · double-click to auto-fit"
		use:resizable={{
			swallow: true,
			onStart: onResizeStart,
			onMove: (dx) => onResizeMove(dx),
			onEnd: (moved) => onResizeEnd(moved),
		}}
		ondblclick={(e) => {
			e.stopPropagation();
			onAutoFit();
		}}
	></span>
</div>

<style>
	
	.cell.head {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 0.4ch;
		padding: 0 0.6ch;
		margin: 0;
		color: var(--text-dim);
		font-family: var(--font-mono);
		font-size: 11.5px;
		letter-spacing: var(--label-tracking);
		text-transform: lowercase;
		background: transparent;
		border: none;
		border-right: 1px solid var(--rule);
		white-space: nowrap;
		overflow: hidden;
		cursor: pointer;
		text-align: left;
	}
	.cell.head:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	.cell.head.active {
		color: var(--accent);
	}
	.cell.head:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.cell.head.dragging {
		opacity: 0.4;
		background: var(--bg-elev-2);
	}
	.head-key {
		flex: 1;
		text-overflow: ellipsis;
		overflow: hidden;
	}
	.col-resize {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		width: 5px;
		cursor: col-resize;
		z-index: 2;
		touch-action: none;
	}
	.col-resize:hover {
		background: var(--accent);
		opacity: 0.6;
	}
	.funnel {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		width: 20px;
		margin-right: 2px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--text-dim);
		opacity: 0.55; 
		transition:
			opacity 0.1s,
			color 0.1s;
	}
	.cell.head:hover .funnel {
		opacity: 0.85;
	}
	.funnel:hover {
		color: var(--text);
		opacity: 1;
		background: var(--bg-elev-3);
	}
	.funnel.on {
		opacity: 1;
		color: var(--accent);
	}
	.mark {
		font-size: 10px;
		opacity: 0.7;
	}
	.mark.mixed {
		color: var(--accent-2);
	}
	.mark.nullable {
		color: var(--syntax-null);
	}
	.sort-arrow {
		color: var(--accent);
		font-size: 9px;
		flex-shrink: 0;
	}
	
	.sort-arrow.hint {
		color: var(--text-faint);
		opacity: 0;
		transition: opacity 0.1s;
	}
	.cell.head:hover .sort-arrow.hint {
		opacity: 0.6;
	}
</style>
