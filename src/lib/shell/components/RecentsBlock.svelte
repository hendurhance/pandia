<script lang="ts">
	import { recentsStore, removeRecent, togglePin } from '../state/recents-store.svelte';
	import { formatSize, relativeTime } from '$lib/util/format';
	import Icon from '$lib/ui/Icon.svelte';
	import { Pin, PinOff, X } from '@lucide/svelte';

	interface Props {
		busy: boolean;
		onPick: (path: string) => void;
	}

	let { busy, onPick }: Props = $props();

	let recentsQuery = $state('');
	const visibleRecents = $derived.by(() => {
		const q = recentsQuery.trim().toLowerCase();
		const filtered = q
			? recentsStore.list.filter(
					(r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
				)
			: recentsStore.list;
		return [...filtered.filter((r) => r.pinned), ...filtered.filter((r) => !r.pinned)];
	});
</script>

<section class="block">
	<div class="label-row">
		<span class="label">recent</span>
		{#if recentsStore.list.length > 0}
			<span class="recent-count dim text-sm"
				>{recentsStore.list.length} file{recentsStore.list.length === 1 ? '' : 's'}</span
			>
		{/if}
	</div>
	{#if recentsStore.list.length > 5}
		<input
			class="recents-search"
			type="search"
			placeholder="search recents…"
			bind:value={recentsQuery}
			spellcheck="false"
			aria-label="Search recent files"
		/>
	{/if}
	{#if recentsStore.list.length === 0}
		<div class="dim text-sm empty-recents">No recent files yet</div>
	{:else if visibleRecents.length === 0}
		<div class="dim text-sm empty-recents">No matches for "{recentsQuery}"</div>
	{:else}
		<ul class="recents">
			{#each visibleRecents.slice(0, 12) as r (r.path)}
				<li class="recent" class:pinned={r.pinned}>
					<button
						class="pin"
						onclick={() => togglePin(r.path)}
						title={r.pinned ? 'Unpin' : 'Pin to top'}
						aria-label={r.pinned ? 'Unpin' : 'Pin'}
						aria-pressed={r.pinned}
					>
						<Icon icon={r.pinned ? Pin : PinOff} size="xs" />
					</button>
					<button
						class="list-row recent-row"
						onclick={() => onPick(r.path)}
						disabled={busy}
						title={r.path}
					>
						<span class="recent-name">{r.name}</span>
						<span class="recent-meta">
							{#if r.size != null}<span class="recent-size">{formatSize(r.size)}</span>{/if}
							<span class="dim recent-when">{relativeTime(r.openedAt)}</span>
						</span>
					</button>
					<button
						class="recent-x"
						onclick={() => removeRecent(r.path)}
						title="Remove from recents"
						aria-label="Remove from recents"
						><Icon icon={X} size="xs" /></button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.label-row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.recent-count {
		white-space: nowrap;
	}
	.recents-search {
		width: 100%;
		padding: 3px 8px;
		font-size: var(--font-size-sm);
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		box-sizing: border-box;
	}
	.recents-search:focus {
		outline: none;
		border-color: var(--accent);
	}
	.recents {
		display: flex;
		flex-direction: column;
		list-style: none;
		padding: 0;
		gap: 0;
	}
	.recent {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: stretch;
		border-bottom: var(--rule-width) solid var(--rule);
	}
	.recent:first-child {
		border-top: var(--rule-width) solid var(--rule);
	}
	.pin {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		background: transparent;
		border: none;
		color: var(--text-ghost);
		cursor: pointer;
	}
	.pin:hover {
		color: var(--accent);
	}
	.recent.pinned .pin {
		color: var(--accent);
	}
	.recent.pinned {
		box-shadow: inset 2px 0 0 var(--accent-line);
	}
	.recent-row {
		justify-content: space-between;
		align-items: baseline;
		gap: 0.8rem;
		padding: 0.5rem 0.6rem;
		color: var(--text);
		min-width: 0;
	}
	.recent-row:hover {
		color: var(--accent);
		background: var(--bg-elev);
	}
	.recent-row:disabled {
		color: var(--text-faint);
		cursor: default;
	}
	.recent-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent-meta {
		flex: 0 0 auto;
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		font-size: var(--font-size-sm);
	}
	.recent-size {
		font-family: var(--font-mono);
		color: var(--accent-2);
		min-width: 4.5ch;
		text-align: right;
	}
	.recent-when {
		min-width: 5ch;
		text-align: right;
	}
	.empty-recents {
		padding: 0.3rem 0;
	}
	.recent-x {
		border: none;
		background: transparent;
		padding: 0 0.6rem;
		font-size: 14px;
		color: var(--text-faint);
		cursor: pointer;
	}
	.recent-x:hover {
		color: var(--accent);
	}
</style>
