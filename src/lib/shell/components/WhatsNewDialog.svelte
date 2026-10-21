<script lang="ts">
	import { X } from '@lucide/svelte';
	import { releases } from '$lib/shell/logic/releases';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ExternalLink from '$lib/ui/ExternalLink.svelte';
	import { CHANGELOG_URL } from '$lib/shell/logic/release-notes';
	import { whatsNew } from '$lib/shell/state/whats-new.svelte';
	import ReleaseNotes from './ReleaseNotes.svelte';

	let { onClose }: { onClose: () => void } = $props();

	const fresh = whatsNew.unseen;
	let selected = $state(whatsNew.running);
	const shown = $derived(releases.find((r) => r.version === selected) ?? releases[0]);

	$effect(() => {
		if (whatsNew.running) void whatsNew.markSeen(whatsNew.running);
	});
</script>

<Dialog {onClose}>
	<div class="dialog sheet" role="dialog" aria-modal="true" aria-label="what's new">
		<div class="dialog-head">
			<span class="dialog-title">what's new</span>
			<span class="grow"></span>
			<button class="btn-close" onclick={onClose} aria-label="close" title="close (esc)"
				><Icon icon={X} size="sm" /></button
			>
		</div>

		<div class="body">
			<nav class="rail" aria-label="versions">
				{#each releases as r (r.version)}
					{@const on = r === shown}
					<button
						class="ver"
						class:on
						aria-current={on ? 'true' : undefined}
						onclick={() => (selected = r.version)}
					>
						<span class="v"
							>{r.version}
							{#if fresh.includes(r.version)}<span class="new">new</span>{/if}</span
						>
						<span class="date">{r.date}</span>
					</button>
				{/each}
			</nav>

			{#if shown}
				{#key shown}
					<div class="notes">
						<div class="notes-head">
							<span class="title">Pandia {shown.version}</span>
							<span class="meta">{shown.date}</span>
						</div>
						<ReleaseNotes groups={shown.groups} />
					</div>
				{/key}
			{/if}
		</div>

		<div class="dialog-foot foot">
			{#if whatsNew.running}<span>You're on {whatsNew.running}</span>{/if}
			<span class="grow"></span>
			<ExternalLink href={CHANGELOG_URL}>Full changelog on pandia.app ↗</ExternalLink>
		</div>
	</div>
</Dialog>

<style>
	.sheet {
		width: min(780px, 92%);
		height: min(540px, 86%);
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.rail {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		width: 168px;
		padding: var(--space-sm) 0;
		overflow-y: auto;
		border-right: var(--rule-width) solid var(--rule);
	}
	.ver {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--space-xs) var(--space-md);
		text-align: left;
		font-size: var(--font-size-sm);
		color: var(--text-dim);
		background: transparent;
		border: none;
		border-left: 2px solid transparent;
	}
	.ver:hover {
		color: var(--text);
	}
	.ver.on {
		color: var(--text);
		background: var(--bg-elev-2);
		border-left-color: var(--accent);
	}
	.v {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}
	.new {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		color: var(--accent);
	}
	.date {
		font-size: var(--font-size-xs);
		color: var(--text-faint);
	}

	.notes {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding: var(--space-lg) var(--space-xl) var(--space-sm);
	}
	.notes-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}
	.title {
		font-family: var(--font-sans);
		font-size: var(--font-size-lg);
		font-weight: 600;
		color: var(--text);
	}
	.meta {
		font-size: var(--font-size-xs);
		color: var(--text-faint);
	}

	.foot {
		gap: var(--space-sm);
		font-size: var(--font-size-xs);
		color: var(--text-faint);
	}
</style>
