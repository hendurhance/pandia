<script lang="ts">
	import {
		sidebarPrefs,
		SIDEBAR_TABS,
		type SidebarTabId,
	} from '$lib/shell/state/sidebar-prefs.svelte';

	$effect(() => {
		void sidebarPrefs.init();
	});

	const PANEL_LABELS: Record<SidebarTabId, string> = {
		outline: 'Outline',
		schema: 'Schema',
		types: 'Types',
		history: 'History',
	};
	const PANEL_HINTS: Record<SidebarTabId, string> = {
		outline: 'collapsible document path tree',
		schema: 'JSON Schema validation',
		types: 'type generation (9 targets)',
		history: 'op-log timeline of edits',
	};

	const enabledCount = $derived(SIDEBAR_TABS.filter((t) => sidebarPrefs.panels[t]).length);
</script>

<div class="settings-panel">
	<header class="settings-head">
		<h2 class="settings-title">Layout</h2>
		<p class="text-sm dim">
			Where the side panel docks and which panels it offers. Persisted across launches · changes
			apply instantly.
		</p>
	</header>

	
	<section class="field">
		<div class="field-label">side panel</div>
		<div class="field-control">
			<div class="seg">
				<button
					class:active={sidebarPrefs.side === 'left'}
					onclick={() => sidebarPrefs.setSide('left')}>left</button
				>
				<button
					class:active={sidebarPrefs.side === 'right'}
					onclick={() => sidebarPrefs.setSide('right')}>right</button
				>
			</div>
			<div class="text-sm dim">Dock the panel on the {sidebarPrefs.side} edge of the canvas.</div>
		</div>
	</section>

	
	<section class="field">
		<div class="field-label">panels</div>
		<div class="field-control">
			<div class="panel-toggles">
				{#each SIDEBAR_TABS as t (t)}
					{@const on = sidebarPrefs.panels[t]}
					<button
						class="switch"
						role="switch"
						aria-checked={on}
						disabled={on && enabledCount <= 1}
						onclick={() => sidebarPrefs.setPanelEnabled(t, !on)}
						title={on && enabledCount <= 1 ? 'at least one panel must stay on' : PANEL_HINTS[t]}
					>
						<span class="switch-knob"></span>
						<span class="switch-text">{PANEL_LABELS[t]}</span>
					</button>
				{/each}
			</div>
			<div class="text-sm dim">
				Unchecked panels are hidden from the sidebar tab strip. At least one must stay on.
			</div>
		</div>
	</section>
</div>

<style>
	.panel-toggles {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		align-items: flex-start;
	}
</style>
