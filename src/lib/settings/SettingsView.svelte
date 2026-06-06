<script lang="ts">
	import { getVersion } from '@tauri-apps/api/app';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';
	import AppearancePanel from '$lib/settings/AppearancePanel.svelte';
	import BehaviorPanel from '$lib/settings/BehaviorPanel.svelte';
	import LayoutPanel from '$lib/settings/LayoutPanel.svelte';
	import DataPanel from '$lib/settings/DataPanel.svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	let version: string | null = $state(null);
	$effect(() => {
		void getVersion()
			.then((v) => (version = v))
			.catch(() => {});
	});

	type SettingsTab = 'appearance' | 'behavior' | 'layout' | 'data' | 'about';

	const TABS = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'behavior', label: 'Behavior' },
		{ id: 'layout', label: 'Layout' },
		{ id: 'data', label: 'Data' },
		{ id: 'about', label: 'About' },
	] as const satisfies ReadonlyArray<{ id: SettingsTab; label: string }>;

	let active: SettingsTab = $state('appearance');

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
			{#each TABS as t (t.id)}
				<button
					class="nav-item"
					class:active={active === t.id}
					onclick={() => (active = t.id)}
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
						A JSON IDE built for files the rest of your tools choke on. Open
						multi-gigabyte documents instantly, navigate them as a tree, code,
						table or node graph, diff two versions, generate types in nine
						languages, validate against JSON Schema. Everything runs locally;
						nothing leaves your machine.
					</p>
					<div class="links">
						<button
							class="link-btn"
							onclick={() => void openInBrowser('https://www.pandia.app')}
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
								void openInBrowser('https://github.com/hendurhance/pandia/issues/new')}
							>Report Issue ↗</button
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
		gap: 1rem;
		padding: 0.5rem 1rem;
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
		padding: 0.2rem 0.6rem;
		color: var(--text-dim);
	}
	.back:hover {
		color: var(--accent);
		border-color: var(--accent);
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
		padding: 1rem 0.4rem;
		gap: 0.1rem;
	}
	.nav-item {
		background: transparent;
		border: none;
		text-align: left;
		padding: 0.35rem 0.6rem;
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
		padding: 1.2rem 1.4rem;
		min-width: 0;
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 520px;
	}
	.h2 {
		margin: 0;
		font-size: 18px;
		letter-spacing: var(--label-tracking);
	}
	.muted {
		color: var(--text-dim);
		line-height: 1.6;
		margin: 0;
	}
	.links {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}
	.link-btn {
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		padding: 0.2rem 0.6rem;
		cursor: pointer;
	}
	.link-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
</style>
