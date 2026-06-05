<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		onClose: () => void;
		
		children: Snippet;
	}

	let { onClose, children }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	function onScrimClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scrim" onclick={onScrimClick} role="presentation">
	{@render children()}
</div>

<style>
	
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
	}
</style>
