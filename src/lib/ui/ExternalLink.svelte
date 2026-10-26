<script lang="ts">
	import type { Snippet } from 'svelte';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';

	let { href, children }: { href: string; children: Snippet } = $props();

	function onclick(e: MouseEvent) {
		e.preventDefault();
		void openInBrowser(href).catch(() => {});
	}
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external URL, not an app route -->
<a {href} {onclick}>{@render children()}</a>

<style>
	a {
		text-underline-offset: 2px;
	}
</style>
