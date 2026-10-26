<script module lang="ts">
	const openDialogs: object[] = [];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		onClose: () => void;

		children: Snippet;
	}

	let { onClose, children }: Props = $props();

	const self = {};

	$effect(() => {
		openDialogs.push(self);
		const returnFocus = document.activeElement;
		return () => {
			openDialogs.splice(openDialogs.indexOf(self), 1);
			if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
		};
	});

	function onKeydown(e: KeyboardEvent) {
		// Every dialog listens on the window; only the top one answers Escape.
		if (e.key === 'Escape' && openDialogs.at(-1) === self) {
			e.preventDefault();
			onClose();
		}
	}

	let pressedScrim = false;

	function onScrimClick(e: MouseEvent) {
		if (pressedScrim && e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="scrim"
	onmousedown={(e) => (pressedScrim = e.target === e.currentTarget)}
	onclick={onScrimClick}
	role="presentation"
>
	{@render children()}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: var(--scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
	}
</style>
