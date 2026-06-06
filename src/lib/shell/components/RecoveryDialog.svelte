<script lang="ts">
	import type { BackupRecord } from '$lib/ipc/types';
	import { basename } from '$lib/util/path';
	import { fmtBytes } from '$lib/util/format';

	let {
		records,
		onRestore,
		onRestoreAll,
		onDiscard,
	}: {
		records: BackupRecord[];
		onRestore: (rec: BackupRecord) => void;
		onRestoreAll: () => void;
		onDiscard: () => void;
	} = $props();

	function recoveryLabel(rec: BackupRecord): string {
		return basename(rec.displayName ?? rec.originalPath ?? 'untitled');
	}
</script>

<div class="dialog recovery" role="dialog" aria-label="recover unsaved work">
	<div class="recovery-head">
		<span class="rec-title">unsaved work recovered</span>
		<span class="dim text-xs">
			{records.length} document{records.length === 1 ? '' : 's'} from a previous session had unsaved changes
		</span>
	</div>
	<ul class="recovery-list">
		{#each records as rec (rec.docId)}
			<li class="recovery-item">
				<button
					class="list-row rec-restore"
					onclick={() => onRestore(rec)}
					title="restore this document"
				>
					<span class="rec-name">{recoveryLabel(rec)}</span>
					<span class="dim text-xs">{fmtBytes(rec.content.length)}</span>
				</button>
			</li>
		{/each}
	</ul>
	<div class="recovery-actions">
		<button class="btn btn-primary" onclick={onRestoreAll}>restore all</button>
		<button class="btn rec-ghost" onclick={onDiscard}>discard all</button>
	</div>
</div>

<style>
	.recovery {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 60;
		min-width: 360px;
		max-width: 520px;
		max-height: 70vh;
	}
	.recovery-head {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.8rem 1rem;
		border-bottom: var(--rule-width) solid var(--rule);
	}
	.rec-title {
		color: var(--accent);
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
		gap: 0.8rem;
		padding: 0.5rem 1rem;
		color: var(--text);
	}
	.rec-restore:hover {
		background: var(--bg-elev-2);
		color: var(--accent);
	}
	.rec-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recovery-actions {
		display: flex;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		border-top: var(--rule-width) solid var(--rule);
	}

	.rec-ghost {
		padding: 0.3rem 0.9rem;
	}
</style>
