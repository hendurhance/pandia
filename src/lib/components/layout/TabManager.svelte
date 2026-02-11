<script lang="ts">
	import { tabs, currentTabId } from '$lib/stores/tabs';
	import Icon from '../ui/Icon.svelte';

	let tabElements: Map<string, HTMLDivElement> = new Map();

	function selectTab(id: string) {
		currentTabId.set(id);
	}

	function closeTab(id: string, event: Event) {
		event.stopPropagation();
		tabs.remove(id);
	}

	function registerTab(node: HTMLDivElement, id: string) {
		tabElements.set(id, node);
		return {
			destroy() {
				tabElements.delete(id);
			}
		};
	}

	$effect(() => {
		const activeId = $currentTabId;
		if (activeId) {
			requestAnimationFrame(() => {
				const tabEl = tabElements.get(activeId);
				if (tabEl) {
					tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
				}
			});
		}
	});
</script>

<div class="tab-container">
	{#each $tabs as tab (tab.id)}
		<div
			use:registerTab={tab.id}
			class="tab {$currentTabId === tab.id ? 'active' : ''} {tab.type === 'compare' ? 'compare-tab' : ''}"
			onclick={() => selectTab(tab.id)}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && selectTab(tab.id)}
		>
			{#if tab.type === 'compare'}
				<Icon name="compare" size={12} class="tab-icon compare-icon" />
			{:else if tab.isDirty}
				<Icon name="tab-dirty" size={8} class="dirty-icon" />
			{/if}
			<span class="tab-title">{tab.title}</span>
			<button
				class="close-btn"
				onclick={(e) => closeTab(tab.id, e)}
				title="Close tab"
			>
				<Icon name="close" size={12} />
			</button>
		</div>
	{/each}
	
	{#if $tabs.length === 0}
		<div class="no-tabs">
			No files open
		</div>
	{/if}
</div>

<style>
	.tab-container {
		display: flex;
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		min-height: 36px;
		align-items: center;
		overflow-x: auto;
		overflow-y: hidden;
		flex-shrink: 0;
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* Internet Explorer 10+ */
	}

	.tab-container::-webkit-scrollbar {
		display: none; /* WebKit */
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--color-surface-secondary);
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		font-size: var(--font-size-sm);
		white-space: nowrap;
		min-width: 100px;
		max-width: 180px;
		user-select: none;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	.tab.active {
		background: var(--color-surface);
		color: var(--color-text);
		border-bottom-color: var(--color-primary);
	}

	.tab:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tab.active:hover {
		background: var(--color-surface);
	}

	.tab-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.dirty-icon) {
		color: var(--color-warning);
		flex-shrink: 0;
	}

	:global(.tab-icon) {
		flex-shrink: 0;
	}

	:global(.compare-icon) {
		color: var(--color-primary);
	}

	.compare-tab {
		border-left: 2px solid var(--color-primary);
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--border-radius-sm);
		font-size: 16px;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.no-tabs {
		padding: 8px 16px;
		color: var(--color-text-muted);
		font-style: italic;
		font-size: var(--font-size-sm);
	}
</style>