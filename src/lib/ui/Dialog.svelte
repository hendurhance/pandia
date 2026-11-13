<script module lang="ts">
	const openDialogs: object[] = [];

	export function isDialogOpen(): boolean {
		return openDialogs.length > 0;
	}
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

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	let scrimEl: HTMLDivElement | undefined = $state();

	function onKeydown(e: KeyboardEvent) {
		// Every dialog listens on the window; only the top one answers Escape.
		if (e.key === 'Escape' && !e.defaultPrevented && openDialogs.at(-1) === self) {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Tab' && !e.defaultPrevented && openDialogs.at(-1) === self) {
			keepFocusInside(e);
		}
	}

	function keepFocusInside(e: KeyboardEvent) {
		if (!scrimEl) return;
		const items = [...scrimEl.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const edge = e.shiftKey ? items[0] : items.at(-1);
		const wrapTo = e.shiftKey ? items.at(-1) : items[0];
		const active = document.activeElement;
		if (wrapTo && active !== edge && scrimEl.contains(active)) return;
		e.preventDefault();
		wrapTo?.focus();
	}

	let pressedScrim = false;

	function onScrimClick(e: MouseEvent) {
		if (pressedScrim && e.target === e.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	bind:this={scrimEl}
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
