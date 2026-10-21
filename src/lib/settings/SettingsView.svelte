<script lang="ts">
	import { getVersion } from '@tauri-apps/api/app';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';
	import AppearancePanel from '$lib/settings/AppearancePanel.svelte';
	import BehaviorPanel from '$lib/settings/BehaviorPanel.svelte';
	import LayoutPanel from '$lib/settings/LayoutPanel.svelte';
	import DataPanel from '$lib/settings/DataPanel.svelte';
	import { SETTINGS_TABS, type SettingsTab } from '$lib/settings/tabs';

	interface Props {
		onClose: () => void;
		active: SettingsTab;
		onSelectTab: (tab: SettingsTab) => void;
	}
	let { onClose, active, onSelectTab }: Props = $props();

	let version: string | null = $state(null);
	$effect(() => {
		void getVersion()
			.then((v) => (version = v))
			.catch(() => {});
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="settings">
	<header class="top">
		<span class="title">Settings</span>
		<span class="grow"></span>
		<button class="back" onclick={onClose} title="Back to canvas (esc)">← Back</button>
	</header>

	<div class="body">
		<nav class="nav" aria-label="settings categories">
			{#each SETTINGS_TABS as t (t.id)}
				<button
					class="nav-item"
					class:active={active === t.id}
					onclick={() => onSelectTab(t.id)}
					aria-current={active === t.id ? 'page' : undefined}>{t.label}</button
				>
			{/each}
		</nav>

		<section class="content">
			{#if active === 'appearance'}
				<AppearancePanel />
			{:else if active === 'behavior'}
				<BehaviorPanel />
			{:else if active === 'layout'}
				<LayoutPanel />
			{:else if active === 'data'}
				<DataPanel />
			{:else if active === 'about'}
				<div class="about">
					<h2 class="h2">Pandia</h2>
					<div class="dim text-sm">{version ? `v${version}` : ''}</div>
					<p class="muted">
						A JSON IDE built for files the rest of your tools choke on. Open multi-gigabyte
						documents instantly, navigate them as a tree, code, table or node graph, diff two
						versions, generate types in ten languages, validate against JSON Schema. Everything runs
						locally; nothing leaves your machine.
					</p>
					<div class="links">
						<button class="link-btn" onclick={() => void openInBrowser('https://www.pandia.app')}
							>Website ↗</button
						>
						<button
							class="link-btn"
							onclick={() => void openInBrowser('https://github.com/hendurhance/pandia')}
							>GitHub ↗</button
						>
						<button
							class="link-btn"
							onclick={() =>
								void openInBrowser('https://github.com/hendurhance/pandia/discussions')}
							>Discussions ↗</button
						>
						<button
							class="link-btn"
							onclick={() =>
								void openInBrowser('https://github.com/hendurhance/pandia/issues/new/choose')}
							>Report Issue ↗</button
						>
						<button
							class="link-btn"
							onclick={() => void openInBrowser('https://github.com/sponsors/hendurhance')}
							>Donate ↗</button
						>
					</div>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.settings {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100%;
		width: 100%;
		background: var(--bg);
	}

	.top {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		padding: var(--space-sm) var(--space-md);
		border-bottom: var(--rule-width) solid var(--rule);
		background: var(--bg);
	}
	:global([data-platform='mac']) .top {
		padding-left: 78px;
		-webkit-app-region: drag;
	}
	:global([data-platform='mac']) .top button {
		-webkit-app-region: no-drag;
	}
	.title {
		font-size: var(--font-size-sm);
		color: var(--text);
	}
	.grow {
		flex: 1;
	}
	.back {
		font-size: var(--font-size-sm);
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		padding: var(--space-2xs) var(--space-sm);
		color: var(--text-dim);
	}
	.back:hover {
		color: var(--text);
		border-color: var(--rule-2);
	}

	.body {
		display: grid;
		grid-template-columns: 200px 1fr;
		min-height: 0;
	}

	.nav {
		display: flex;
		flex-direction: column;
		border-right: var(--rule-width) solid var(--rule);
		background: var(--bg);
		padding: var(--space-md) var(--space-xs);
		gap: var(--space-2xs);
	}
	.nav-item {
		background: transparent;
		border: none;
		text-align: left;
		padding: var(--space-xs) var(--space-sm);
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.nav-item:hover {
		color: var(--text);
	}
	.nav-item.active {
		color: var(--text);
		background: var(--bg-elev);
		box-shadow: inset 2px 0 0 0 var(--accent);
	}

	.content {
		overflow-y: auto;
		padding: var(--space-lg);
		min-width: 0;
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		max-width: 520px;
	}
	.h2 {
		margin: 0;
		font-size: var(--font-size-title);
		letter-spacing: var(--label-tracking);
	}
	.muted {
		color: var(--text-dim);
		line-height: 1.6;
		margin: 0;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		margin-top: var(--space-xs);
	}
	.link-btn {
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		padding: var(--space-2xs) var(--space-sm);
		cursor: pointer;
	}
	.link-btn:hover {
		color: var(--text);
		border-color: var(--rule-2);
	}
</style>
