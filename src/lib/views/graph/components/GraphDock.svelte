<script lang="ts">
	import Icon from '$lib/ui/Icon.svelte';
	import {
		ChevronUp,
		Crosshair,
		Download,
		Expand,
		FoldVertical,
		Maximize,
		Minus,
		Plus,
		Settings,
		Shrink,
		UnfoldVertical,
	} from '@lucide/svelte';
	import type { ExportFormat } from './GraphExportMenu.svelte';

	interface Props {
		zoomPct: number;

		onCenterFirst: () => void;

		onFitView: () => void;

		onExpandAll: () => void;

		onCollapseAll: () => void;
		onZoomOut: () => void;
		onZoomIn: () => void;
		onExportDefault: () => void;
		onToggleExportMenu: () => void;

		onToggleFullscreen: () => void;

		isFullscreen?: boolean;

		onToggleSettings: () => void;

		settingsOpen?: boolean;

		settingsBtn?: HTMLButtonElement | null;
		exportBtn?: HTMLButtonElement | null;
		exportMenuOpen?: boolean;
		exportFormat: ExportFormat;
		expandDisabled?: boolean;
		exportDisabled?: boolean;
	}

	let {
		zoomPct,
		onCenterFirst,
		onFitView,
		onExpandAll,
		onCollapseAll,
		onZoomOut,
		onZoomIn,
		onExportDefault,
		onToggleExportMenu,
		onToggleFullscreen,
		isFullscreen = false,
		onToggleSettings,
		settingsOpen = false,
		settingsBtn = $bindable(null),
		exportBtn = $bindable(null),
		exportMenuOpen = false,
		exportFormat,
		expandDisabled = false,
		exportDisabled = false,
	}: Props = $props();
</script>

<div class="dock" role="toolbar" aria-label="Graph controls">
	<button
		class="dock-btn"
		title="Center first item"
		aria-label="Center first item"
		onclick={onCenterFirst}
	>
		<Icon icon={Crosshair} size="sm" />
	</button>

	<button class="dock-btn" title="Fit to center" aria-label="Fit to center" onclick={onFitView}>
		<Icon icon={Maximize} size="sm" />
	</button>

	<button
		class="dock-btn"
		title="Expand all"
		aria-label="Expand all"
		onclick={onExpandAll}
		disabled={expandDisabled}
	>
		<Icon icon={UnfoldVertical} size="sm" />
	</button>

	<button class="dock-btn" title="Collapse all" aria-label="Collapse all" onclick={onCollapseAll}>
		<Icon icon={FoldVertical} size="sm" />
	</button>

	<div class="dock-sep" aria-hidden="true"></div>

	<button class="dock-btn" title="Zoom out" aria-label="Zoom out" onclick={onZoomOut}>
		<Icon icon={Minus} size="sm" />
	</button>
	<span class="dock-zoom" title="Zoom level" aria-live="polite">{zoomPct}%</span>
	<button class="dock-btn" title="Zoom in" aria-label="Zoom in" onclick={onZoomIn}>
		<Icon icon={Plus} size="sm" />
	</button>

	<div class="dock-sep" aria-hidden="true"></div>

	<button
		class="dock-btn"
		class:on={settingsOpen}
		bind:this={settingsBtn}
		title="Graph settings"
		aria-label="Graph settings"
		aria-expanded={settingsOpen}
		onclick={onToggleSettings}
	>
		<Icon icon={Settings} size="sm" />
	</button>

	<button
		class="dock-btn"
		title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
		aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
		aria-pressed={isFullscreen}
		onclick={onToggleFullscreen}
	>
		<Icon icon={isFullscreen ? Shrink : Expand} size="sm" />
	</button>

	<div class="dock-split">
		<button
			class="dock-btn dock-split-main"
			title={`Download as ${exportFormat.toUpperCase()}`}
			aria-label={`Download graph as ${exportFormat.toUpperCase()}`}
			onclick={onExportDefault}
			disabled={exportDisabled}
		>
			<Icon icon={Download} size="sm" />
		</button>
		<button
			class="dock-btn dock-split-caret"
			class:on={exportMenuOpen}
			bind:this={exportBtn}
			title="Choose export format"
			aria-label="Choose export format"
			aria-haspopup="menu"
			aria-expanded={exportMenuOpen}
			onclick={onToggleExportMenu}
			disabled={exportDisabled}
		>
			<Icon icon={ChevronUp} size="sm" />
		</button>
	</div>
</div>

<style>
	.dock {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: var(--space-2xs);
		padding: var(--space-xs);
		background: var(--bg-elev-2);
		border: 1px solid var(--rule-2);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
		z-index: 2;
	}
	.dock-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--text-dim);
		cursor: pointer;
		transition:
			color 80ms linear,
			background-color 80ms linear;
	}
	.dock-btn:hover:not(:disabled) {
		color: var(--text);
		background: var(--bg-elev-3);
	}
	.dock-btn.on {
		color: var(--accent);
		background: var(--bg-elev-3);
	}
	.dock-btn:disabled {
		color: var(--text-faint);
		cursor: default;
	}
	.dock-split {
		display: flex;
		align-items: center;
	}
	.dock-split-main {
		border-radius: 6px 0 0 6px;
	}
	.dock-split-caret {
		width: 20px;
		border-radius: 0 6px 6px 0;
		border-left: 1px solid var(--rule-2);
	}
	.dock-sep {
		width: 1px;
		height: 18px;
		background: var(--rule-2);
		margin: 0 var(--space-2xs);
	}
	.dock-zoom {
		min-width: 4ch;
		text-align: center;
		font-size: var(--font-size-sm);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
</style>
