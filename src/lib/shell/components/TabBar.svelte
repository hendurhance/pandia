<script lang="ts">
	import type { DocStatus } from '$lib/shell/logic/status';
	import Icon from '$lib/ui/Icon.svelte';
	import { X, Plus } from '@lucide/svelte';

	interface Tab {
		id: string;
		label: string;
	}

	let {
		tabs,
		activeTabId,
		tabStatuses,
		capWarning,
		maxTabs,
		hasActiveDoc,
		comparePickerOpen,
		compareBtnEl = $bindable(null),
		onActivate,
		onClose,
		onNew,
		onReorder,
		onToggleCompare,
		onExport,
	}: {
		tabs: Tab[];
		activeTabId: string;
		tabStatuses: Record<string, DocStatus | null>;
		capWarning: boolean;
		maxTabs: number;
		hasActiveDoc: boolean;
		comparePickerOpen: boolean;
		
		compareBtnEl?: HTMLElement | null;
		onActivate: (id: string) => void;
		onClose: (id: string) => void;
		onNew: () => void;
		onReorder: (sourceId: string, targetId: string) => void;
		onToggleCompare: () => void;
		onExport: () => void;
	} = $props();

	let draggingId: string | null = $state(null);
	let dragOverId: string | null = $state(null);
	let dragStart: { tabId: string; x: number; y: number; pointerId: number } | null = null;
	const DRAG_THRESHOLD_PX = 4;

	function onTabPointerDown(id: string, e: PointerEvent) {
		if ((e.target as HTMLElement).closest('.tab-close')) return;
		if (e.button !== 0) return;
		dragStart = { tabId: id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}

	function onTabPointerMove(e: PointerEvent) {
		if (!dragStart) return;
		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;
		if (!draggingId && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
			return;
		}
		draggingId = dragStart.tabId;
		const hit = document.elementFromPoint(e.clientX, e.clientY);
		const overTab = hit?.closest('[data-tab-id]') as HTMLElement | null;
		dragOverId = overTab?.dataset.tabId ?? null;
	}

	function onTabPointerUp(e: PointerEvent) {
		if (!dragStart) return;
		const sourceId = draggingId;
		const targetId = dragOverId;
		try {
			(e.currentTarget as Element).releasePointerCapture(dragStart.pointerId);
		} catch {
			
		}
		dragStart = null;
		draggingId = null;
		dragOverId = null;
		if (sourceId && targetId && sourceId !== targetId) onReorder(sourceId, targetId);
	}

	function onTabPointerCancel() {
		dragStart = null;
		draggingId = null;
		dragOverId = null;
	}
</script>

<nav class="tab-bar" aria-label="open documents">
	<div class="tab-scroll">
		{#each tabs as tab (tab.id)}
			<div
				class="tab"
				class:active={tab.id === activeTabId}
				class:dragging={draggingId === tab.id}
				class:drag-over={dragOverId === tab.id && draggingId !== tab.id}
				data-tab-id={tab.id}
				onpointerdown={(e) => onTabPointerDown(tab.id, e)}
				onpointermove={onTabPointerMove}
				onpointerup={onTabPointerUp}
				onpointercancel={onTabPointerCancel}
				onclick={() => {
					if (!draggingId) onActivate(tab.id);
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onActivate(tab.id);
					}
				}}
				role="tab"
				tabindex="0"
				aria-selected={tab.id === activeTabId}
				title={tab.label}
			>
				<span
					class="tab-dot"
					class:loaded={tabStatuses[tab.id] != null}
					class:dirty={tabStatuses[tab.id]?.dirty}
					aria-hidden="true"
				></span>
				<span class="tab-label">{tab.label}</span>
				<button
					class="tab-close"
					onclick={(e) => {
						e.stopPropagation();
						onClose(tab.id);
					}}
					title="Close tab (⌘W)"
					aria-label="Close tab"
					><Icon icon={X} size="xs" /></button
				>
			</div>
		{/each}
		<button
			class="tab-new"
			onclick={onNew}
			title={tabs.length >= maxTabs ? `Max ${maxTabs} tabs` : 'New tab (⌘T)'}
			disabled={tabs.length >= maxTabs}
			aria-label="New tab"><Icon icon={Plus} size="sm" /></button
		>
		{#if capWarning}
			<span class="cap-warn text-xs dim">Max {maxTabs} tabs · close one to open another</span>
		{/if}
	</div>
	<div class="tab-bar-actions">
		<button
			bind:this={compareBtnEl}
			class="tba"
			class:on={comparePickerOpen}
			onclick={onToggleCompare}
			disabled={!hasActiveDoc}
			title="Diff against an open tab or a file"
			aria-haspopup="menu"
			aria-expanded={comparePickerOpen}
		>
			<span>Compare</span><span class="kbd">⌘D</span>
		</button>
		<button
			class="tba"
			onclick={onExport}
			disabled={!hasActiveDoc}
			title="Export to JSON (pretty / minified) · YAML · CSV · XML"
		>
			<span>Export</span><span class="kbd">⌘E</span>
		</button>
	</div>
</nav>

<style>
	.tab-bar {
		display: flex;
		align-items: stretch;
		height: var(--tab-h);
		user-select: none;
	}

	
	.tab,
	.tab-new,
	.tba {
		-webkit-app-region: no-drag;
	}

	
	.tab-scroll {
		display: flex;
		align-items: stretch;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}
	
	.tab-scroll::-webkit-scrollbar {
		height: 4px;
	}

	.tab {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 16px;
		font-size: var(--font-size-sm);
		color: var(--text-dim);
		border-right: var(--rule-width) solid var(--rule);
		cursor: pointer;
		white-space: nowrap;
		flex: 0 0 auto;
		max-width: 220px;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--text);
		background: var(--bg-elev);
	}
	.tab.active::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--accent);
	}
	.tab.dragging {
		opacity: 0.4;
	}
	.tab.drag-over {
		box-shadow: inset 2px 0 0 0 var(--accent);
	}

	.tab-dot {
		width: 6px;
		height: 6px;
		background: var(--text-faint);
		flex-shrink: 0;
	}
	.tab-dot.loaded {
		background: var(--accent-2);
	}
	.tab-dot.dirty {
		background: var(--accent);
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
	}

	.tab-close {
		border: none;
		background: transparent;
		padding: 0 0 0 4px;
		font-size: 11px;
		line-height: 1;
		color: var(--text-faint);
		cursor: pointer;
	}
	.tab-close:hover {
		color: var(--accent);
	}

	.tab-new {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		border: none;
		background: transparent;
		font-size: 16px;
		line-height: 1;
		color: var(--text-faint);
		border-right: var(--rule-width) solid var(--rule);
		cursor: pointer;
		flex-shrink: 0;
	}
	.tab-new:hover {
		color: var(--accent);
	}
	.tab-new:disabled {
		color: var(--text-ghost);
		cursor: default;
	}

	.cap-warn {
		display: flex;
		align-items: center;
		padding: 0 0.6rem;
	}

	.tab-bar-actions {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
	}
	.tba {
		height: 100%;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0 14px;
		background: transparent;
		border: none;
		border-left: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
		font-size: var(--font-size-xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
	}
	.tba:hover {
		color: var(--text);
		background: var(--bg-elev);
	}
	.tba:disabled {
		color: var(--text-ghost);
		cursor: default;
	}
	.tba:disabled:hover {
		color: var(--text-ghost);
		background: transparent;
	}
	.tba .kbd {
		color: var(--text-faint);
		font-size: 10px;
		letter-spacing: 0;
	}
	.tba.on {
		color: var(--text);
		background: var(--bg-elev);
	}
</style>
