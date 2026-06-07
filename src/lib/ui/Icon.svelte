<script lang="ts">
	import type { Component } from 'svelte';

	type Size = 'xs' | 'sm' | 'md' | number;

	interface Props {
		icon: Component<{ size?: number | string; strokeWidth?: number | string; color?: string }>;

		size?: Size;

		strokeWidth?: number;
	}

	let { icon: IconComp, size = 'sm', strokeWidth = 1.5 }: Props = $props();

	const px = $derived(typeof size === 'number' ? size : { xs: 12, sm: 14, md: 16 }[size]);
</script>

<span class="ui-icon" aria-hidden="true">
	<IconComp size={px} {strokeWidth} color="currentColor" />
</span>

<style>
	.ui-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: middle;
		line-height: 0;
		color: inherit;

		flex-shrink: 0;
	}
	.ui-icon :global(svg) {
		display: block;
	}
</style>
