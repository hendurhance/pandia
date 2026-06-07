<script lang="ts">
	import type { Snippet } from 'svelte';
	import { dismissable } from './dismissable';

	interface Props {
		x: number;
		y: number;

		width?: number;
		height?: number;

		flushAllowance?: number;

		anchorEl?: HTMLElement | null;
		onClose: () => void;

		children: Snippet<[{ flushRight: boolean }]>;
	}

	let {
		x,
		y,
		width = 0,
		height = 0,
		flushAllowance = 0,
		anchorEl = null,
		onClose,
		children,
	}: Props = $props();

	let vw = $state(window.innerWidth);
	let vh = $state(window.innerHeight);

	$effect(() => {
		const onResize = () => {
			vw = window.innerWidth;
			vh = window.innerHeight;
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	// Keep popovers at least this many pixels off the viewport edge so the
	// shadow/rounded corner is fully visible.
	const EDGE_MARGIN_PX = 8;
	const flushRight = $derived(x + width + flushAllowance > vw);
	const style = $derived.by(() => {
		const left = Math.min(x, Math.max(0, vw - width - EDGE_MARGIN_PX));
		const top = Math.min(y, Math.max(0, vh - height - EDGE_MARGIN_PX));
		return `left: ${left}px; top: ${top}px;`;
	});
</script>

<div class="popover" {style} use:dismissable={{ onDismiss: onClose, ignore: anchorEl }}>
	{@render children({ flushRight })}
</div>

<style>
	.popover {
		position: fixed;
		z-index: 1000;
	}
</style>
