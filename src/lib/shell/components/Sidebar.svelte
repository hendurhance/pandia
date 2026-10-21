<script lang="ts">
	import type { DocContext } from '$lib/shell/state/workspace.svelte';
	import {
		sidebarPrefs,
		MIN_WIDTH,
		MAX_WIDTH,
		type SidebarTabId,
	} from '../state/sidebar-prefs.svelte';
	import SchemaPanel from '$lib/panels/SchemaPanel.svelte';
	import TypegenPanel from '$lib/panels/TypegenPanel.svelte';
	import OutlinePanel from '$lib/panels/OutlinePanel.svelte';
	import HistoryPanel from '$lib/panels/HistoryPanel.svelte';
	import type { Path } from '$lib/ipc/bindings';
	import { resizable } from '$lib/ui/resizable';

	interface Props {
		activeTabId: string;
		activeContext: DocContext | null;
		onNavigate?: (path: Path) => void;
		onHistoryStep?: (delta: number) => void;
	}

	let {
		activeTabId,
		activeContext,
		onNavigate = () => {},
		onHistoryStep = () => {},
	}: Props = $props();

	const TAB_LABELS: Record<SidebarTabId, string> = {
		outline: 'outline',
		schema: 'schema',
		types: 'types',
		history: 'history',
	};

	const TAB_HINTS: Record<SidebarTabId, string> = {
		outline: 'document outline — collapsible path tree.',
		schema: '',
		types: '',
		history: 'op-log timeline — every apply/undo/redo step, navigable.',
	};

	function activate(t: SidebarTabId) {
		sidebarPrefs.setActiveTab(t);
	}

	let dragging = $state(false);
	let resizeStartW = 0;
	// What's on screen, which can be wider than the saved width when the tab words need more room.
	let renderedWidth = $state(0);

	function onResizeDouble() {
		sidebarPrefs.setWidth((MIN_WIDTH + MAX_WIDTH) / 2 - 30);
	}

	function onResizeKey(e: KeyboardEvent) {
		const growKey = sidebarPrefs.side === 'right' ? 'ArrowLeft' : 'ArrowRight';
		const shrinkKey = sidebarPrefs.side === 'right' ? 'ArrowRight' : 'ArrowLeft';
		if (e.key === growKey) {
			e.preventDefault();
			sidebarPrefs.setWidth(renderedWidth + 16);
		} else if (e.key === shrinkKey) {
			e.preventDefault();
			sidebarPrefs.setWidth(renderedWidth - 16);
		}
	}
</script>

{#snippet resizeHandle()}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="resize"
		class:dragging
		role="separator"
		aria-orientation="vertical"
		aria-label="resize sidebar"
		aria-valuenow={renderedWidth}
		aria-valuemin={MIN_WIDTH}
		aria-valuemax={MAX_WIDTH}
		tabindex="0"
		use:resizable={{
			onStart: () => {
				dragging = true;
				resizeStartW = renderedWidth;
			},
			onMove: (dx) =>
				sidebarPrefs.setWidthLive(resizeStartW + (sidebarPrefs.side === 'right' ? -dx : dx)),
			onEnd: (moved) => {
				dragging = false;
				if (moved) sidebarPrefs.commitWidth();
			},
		}}
		ondblclick={onResizeDouble}
		onkeydown={onResizeKey}
	></div>
{/snippet}

{#if sidebarPrefs.side === 'right'}{@render resizeHandle()}{/if}

<aside
	class="sidebar"
	class:right={sidebarPrefs.side === 'right'}
	style="width: {sidebarPrefs.width}px;"
	bind:offsetWidth={renderedWidth}
	aria-label="sidebar"
>
	<nav class="tabs" aria-label="sidebar tabs">
		{#each sidebarPrefs.enabledTabs as t (t)}
			<button
				class="tab"
				class:active={sidebarPrefs.activeTab === t}
				onclick={() => activate(t)}
				aria-current={sidebarPrefs.activeTab === t ? 'page' : undefined}
			>
				{TAB_LABELS[t]}
			</button>
		{/each}
	</nav>

	<section class="body">
		{#if sidebarPrefs.activeTab === 'outline'}
			<OutlinePanel context={activeContext} {onNavigate} />
		{:else if sidebarPrefs.activeTab === 'schema'}
			<SchemaPanel tabId={activeTabId} context={activeContext} onJump={onNavigate} />
		{:else if sidebarPrefs.activeTab === 'types'}
			<TypegenPanel context={activeContext} />
		{:else if sidebarPrefs.activeTab === 'history'}
			<HistoryPanel context={activeContext} onStep={onHistoryStep} />
		{:else}
			<div class="placeholder">
				<div class="label">{TAB_LABELS[sidebarPrefs.activeTab]}</div>
				<div class="ph-hint">{TAB_HINTS[sidebarPrefs.activeTab]}</div>
			</div>
		{/if}
	</section>
</aside>

{#if sidebarPrefs.side !== 'right'}{@render resizeHandle()}{/if}

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		/* Never narrower than the tab words, whatever the font, size or density. */
		min-width: min-content;
		min-height: 0;
		background: var(--bg);
		border-right: var(--rule-width) solid var(--rule);
		overflow: hidden;
	}

	.sidebar.right {
		border-right: none;
		border-left: var(--rule-width) solid var(--rule);
	}

	.tabs {
		display: flex;
		flex-direction: row;
		align-items: stretch;
		height: 32px;
		border-bottom: var(--rule-width) solid var(--rule);
		flex: 0 0 auto;
	}

	.tab {
		flex: 1 1 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-right: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		cursor: pointer;
		padding: 0 var(--space-sm);
		white-space: nowrap;
		position: relative;
	}
	.tab:last-child {
		border-right: none;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--text);
	}
	.tab.active::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;

		bottom: -1px;
		height: 1px;
		background: var(--accent);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* Wide panel content scrolls instead of widening the panel. */
		contain: inline-size;
		padding: var(--space-md);
	}

	.placeholder {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}
	.ph-hint {
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.resize {
		flex: 0 0 auto;
		width: 4px;
		margin-left: -2px;
		margin-right: -2px;
		cursor: ew-resize;
		background: transparent;
		z-index: 5;
		position: relative;
		user-select: none;
		touch-action: none;
	}
	.resize::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 2px;
		width: 1px;
		background: transparent;
		transition: background 80ms linear;
	}
	.resize:hover::before {
		background: var(--text-faint);
	}
	.resize:focus-visible::before,
	.resize.dragging::before {
		background: var(--accent);
	}
	.resize:focus-visible {
		outline: none;
	}
</style>
