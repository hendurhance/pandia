<script lang="ts">
import '../app.css';
import { onMount } from 'svelte';
import { initTheme } from '$lib/stores/theme';

let { children } = $props();

onMount(() => {
	initTheme();
});

</script>

<main>
  {@render children()}
</main>

<style>
	main {
		height: 100vh;
		width: 100vw;
		overflow: hidden;
		background: var(--color-background);
		color: var(--color-text);
	}

</style>