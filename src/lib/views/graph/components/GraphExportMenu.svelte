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
				>{rasterDownscaled ? 'recommended — sharp at full size' : 'vector · sharp at any zoom'}</span
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
		padding: 0.3rem;
		background: var(--bg-elev-2);
		border: 1px solid var(--rule-2);
		border-radius: 8px;
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
	}
	.menu button {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.45rem 0.6rem;
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
		font-weight: 600;
		font-size: 13px;
	}
	.hint {
		font-size: 10.5px;
		color: var(--text-faint);
	}
</style>
