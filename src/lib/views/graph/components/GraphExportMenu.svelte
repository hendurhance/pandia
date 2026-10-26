<script lang="ts">
	import { dismissable } from '$lib/ui/dismissable';

	export type ExportFormat = 'png' | 'jpeg' | 'svg';

	interface Props {
		open: boolean;
		onPick: (format: ExportFormat) => void;
		onClose: () => void;
		anchor?: HTMLElement | null;
		rasterDownscaled?: boolean;
	}

	let { open, onPick, onClose, anchor, rasterDownscaled = false }: Props = $props();

	function pick(f: ExportFormat) {
		onClose();
		onPick(f);
	}
</script>

{#if open}
	<div
		class="menu"
		role="menu"
		aria-label="export format"
		use:dismissable={{ onDismiss: onClose, ignore: anchor ?? null }}
	>
		<button role="menuitem" onclick={() => pick('png')}>
			<span class="name">PNG</span>
			<span class="hint"
				>{rasterDownscaled ? 'will be downscaled — too tall for raster' : 'crisp raster · 4x'}</span
			>
		</button>
		<button role="menuitem" onclick={() => pick('jpeg')}>
			<span class="name">JPEG</span>
			<span class="hint">{rasterDownscaled ? 'will be downscaled' : 'smaller file'}</span>
		</button>
		<button role="menuitem" onclick={() => pick('svg')}>
			<span class="name">SVG</span>
			<span class="hint"
				>{rasterDownscaled
					? 'recommended — sharp at full size'
					: 'vector · sharp at any zoom'}</span
			>
		</button>
	</div>
{/if}

<style>
	.menu {
		position: absolute;
		bottom: 60px;
		right: 16px;
		z-index: 3;
		display: flex;
		flex-direction: column;
		min-width: 220px;
		padding: var(--space-xs);
		background: var(--bg-elev-2);
		border: 1px solid var(--rule-2);
		border-radius: 8px;
		box-shadow: var(--shadow-pop);
	}
	.menu button {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-md);
		padding: var(--space-xs) var(--space-sm);
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--bg-elev-3);
		outline: none;
	}
	.menu button:focus-visible {
		color: var(--accent);
	}
	.name {
		font-weight: 700;
		font-size: var(--font-size-base);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-dim);
	}
</style>
