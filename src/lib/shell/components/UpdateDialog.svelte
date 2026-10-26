<script lang="ts">
	import type { Update } from '@tauri-apps/plugin-updater';
	import { X } from '@lucide/svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ExternalLink from '$lib/ui/ExternalLink.svelte';
	import { CHANGELOG_URL, fromMarkdown } from '$lib/shell/logic/release-notes';
	import { updateCheck } from '$lib/shell/state/update-check.svelte';
	import { whatsNew } from '$lib/shell/state/whats-new.svelte';
	import ReleaseNotes from './ReleaseNotes.svelte';

	let { update }: { update: Update } = $props();

	// The body comes from latest.json, which is not signed: parse it, never render it as HTML.
	const groups = $derived(fromMarkdown(update.body ?? ''));

	let installBtn: HTMLButtonElement | undefined = $state();
	$effect(() => {
		const t = setTimeout(() => installBtn?.focus(), 0);
		return () => clearTimeout(t);
	});

	async function install() {
		// The user read these notes here, so the new version should not offer them again.
		await whatsNew.markSeen(update.version);
		await updateCheck.install();
	}
</script>

<Dialog onClose={() => updateCheck.later()}>
	<div class="dialog sheet" role="dialog" aria-modal="true" aria-label="update available">
		<div class="dialog-head">
			<span class="dialog-title">update available</span>
			<span class="grow"></span>
			<button
				class="btn-close"
				onclick={() => updateCheck.later()}
				aria-label="close"
				title="close (esc)"><Icon icon={X} size="sm" /></button
			>
		</div>

		<div class="summary">
			<div class="title">Pandia {update.version} is ready to install</div>
			<div class="meta">
				You're on {update.currentVersion}. Installing restarts Pandia. It offers to restore unsaved
				changes when it reopens.
			</div>
		</div>

		<div class="notes">
			{#if groups}
				<ReleaseNotes {groups} />
			{:else}
				<p class="empty">
					No release notes for this version.
					<ExternalLink href={CHANGELOG_URL}>Full changelog on pandia.app ↗</ExternalLink>
				</p>
			{/if}
		</div>

		{#if updateCheck.error}
			<p class="error" role="alert">{updateCheck.error}</p>
		{/if}

		<div class="dialog-foot">
			<button
				class="btn btn-ghost"
				disabled={updateCheck.installing}
				onclick={() => void updateCheck.skip()}>Skip this version</button
			>
			<span class="grow"></span>
			<button class="btn" onclick={() => updateCheck.later()}>Later</button>
			<button
				bind:this={installBtn}
				class="btn btn-primary"
				disabled={updateCheck.installing}
				onclick={() => void install()}
				>{updateCheck.installing ? 'Downloading…' : 'Install and restart'}</button
			>
		</div>
	</div>
</Dialog>

<style>
	.sheet {
		width: min(640px, 92%);
		max-height: min(520px, 86%);
	}
	.summary {
		padding: var(--space-md) var(--space-lg) var(--space-xs);
		font-family: var(--font-sans);
	}
	.title {
		font-size: var(--font-size-lg);
		font-weight: 600;
		color: var(--text);
	}
	.meta {
		margin-top: var(--space-2xs);
		color: var(--text-dim);
	}
	.notes {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-xs) var(--space-lg) var(--space-sm);
	}
	.empty {
		margin-top: var(--space-md);
		font-family: var(--font-sans);
		color: var(--text-dim);
	}
	.error {
		padding: 0 var(--space-lg) var(--space-sm);
		font-family: var(--font-sans);
		color: var(--danger);
	}
</style>
