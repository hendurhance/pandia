<script lang="ts">
	import type { BackupRecord } from '$lib/ipc/bindings';
	import { basename } from '$lib/util/path';
	import { fmtBytes } from '$lib/util/format';
	import Dialog from '$lib/ui/Dialog.svelte';

	let {
		records,
		onRestore,
		onRestoreAll,
		onDiscard,
		onLater,
	}: {
		records: BackupRecord[];
		onRestore: (rec: BackupRecord) => void;
		onRestoreAll: () => void;
		onDiscard: () => void;
		onLater: () => void;
	} = $props();

	let primaryBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		const t = setTimeout(() => primaryBtn?.focus(), 0);
		return () => clearTimeout(t);
	});

	function recoveryLabel(rec: BackupRecord): string {
		return basename(rec.displayName ?? rec.originalPath ?? 'untitled');
	}
</script>

<Dialog onClose={onLater}>
	<div class="dialog recovery" role="dialog" aria-modal="true" aria-label="recover unsaved work">
		<div class="recovery-head">
			<span class="rec-title">unsaved work recovered</span>
			<span class="dim text-xs">
				{records.length} document{records.length === 1 ? '' : 's'} from a previous session had unsaved
				changes
			</span>
		</div>
		<ul class="recovery-list">
			{#each records as rec (rec.docId)}
				<li class="recovery-item">
					<button
						class="list-row rec-restore"
						onclick={() => onRestore(rec)}
						title={rec.originalPath ?? rec.displayName ?? 'untitled'}
					>
						<span class="rec-name">{recoveryLabel(rec)}</span>
						<span class="dim text-xs">{fmtBytes(rec.content.length)}</span>
					</button>
				</li>
			{/each}
		</ul>
		<div class="recovery-actions">
			<button class="btn btn-ghost rec-ghost" onclick={onDiscard}>discard all</button>
			<button class="btn" onclick={onLater}>later<span class="hint">esc</span></button>
			<button bind:this={primaryBtn} class="btn btn-primary" onclick={onRestoreAll}
				>restore all</button
			>
		</div>
	</div>
</Dialog>

<style>
	.recovery {
		min-width: 360px;
		max-width: 520px;
		max-height: 70vh;
	}
	.recovery-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2xs);
		padding: var(--space-md);
		border-bottom: var(--rule-width) solid var(--rule);
	}
	.rec-title {
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
	}
	.recovery-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		min-height: 0;
	}
	.recovery-item {
		border-bottom: var(--rule-width) solid var(--rule);
	}

	.rec-restore {
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-md);
		padding: var(--space-sm) var(--space-md);
		color: var(--text);
	}
	.rec-restore:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	.rec-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recovery-actions {
		display: flex;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		border-top: var(--rule-width) solid var(--rule);
	}

	.rec-ghost {
		margin-right: auto;
		padding: var(--space-xs) var(--space-md);
	}
	.hint {
		color: var(--text-dim);
		margin-left: var(--space-xs);
	}
</style>
