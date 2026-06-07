<script lang="ts">
	import '../app.css';
	import { appearancePrefs } from '$lib/settings/state/appearance-prefs.svelte';
	import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
	import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
	import { recentsStore } from '$lib/shell/state/recents-store.svelte';
	import { typegenPrefs } from '$lib/panels/state/typegen-prefs.svelte';
	import { commandUsage } from '$lib/palette/state/command-store.svelte';
	import NativeContextMenu from '$lib/ui/NativeContextMenu.svelte';

	let { children } = $props();

	$effect(() => {
		void appearancePrefs.init();
		void behaviorPrefs.init();
		void sidebarPrefs.init();
		void recentsStore.init();
		void typegenPrefs.init();
		void commandUsage.init();
	});

	$effect(() => {
		const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
		document.documentElement.dataset.platform = isMac ? 'mac' : 'other';
	});
</script>

<main>
	{@render children()}
</main>

<NativeContextMenu />

<style>
	main {
		height: 100vh;
		width: 100vw;
		overflow: hidden;
	}
</style>
