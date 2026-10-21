<script lang="ts">
	import type { DocContext } from '$lib/shell/state/workspace.svelte';
	import { ipc } from '$lib/ipc/client';
	import { describeError } from '$lib/ipc/error-copy';
	import type { HistoryView } from '$lib/ipc/bindings';

	interface Props {
		context: DocContext | null;

		onStep?: (delta: number) => void;
	}

	let { context, onStep }: Props = $props();

	let view = $state<HistoryView | null>(null);
	let error = $state<string | null>(null);
	let loadedKey = '';

	$effect(() => {
		const ctx = context;
		if (!ctx) {
			view = null;
			loadedKey = '';
			return;
		}
		const key = `${ctx.handle}@${ctx.version}`;
		if (key === loadedKey) return;
		loadedKey = key;
		void ipc
			.docHistory(ctx.handle)
			.then((v) => {
				if (loadedKey === key) {
					view = v;
					error = null;
				}
			})
			.catch((e) => {
				if (loadedKey === key) error = describeError(e);
			});
	});

	const total = $derived((view?.undo.length ?? 0) + (view?.redo.length ?? 0));
</script>

<div class="panel">
	{#if !context}
		<div class="empty dim text-xs">No document in this tab</div>
	{:else if error}
		<div class="empty err text-xs">{error}</div>
	{:else if !view || total === 0}
		<div class="empty dim text-xs">No edits yet · changes you make appear here</div>
	{:else}
		<div class="section-label">
			<span>timeline</span>
			<span class="section-count">{total}{total >= view.cap ? ` · cap ${view.cap}` : ''}</span>
		</div>
		<div class="scroller">
			{#each view.undo as e, i (`u${i}`)}
				<button
					class="list-row entry past"
					onclick={() => onStep?.(-(view!.undo.length - i))}
					title={`undo to before ${e.pathDisplay}`}
				>
					<span class="bullet">●</span>
					<span class="lbl">{e.label}</span>
					<span class="path">{e.pathDisplay}</span>
				</button>
			{/each}

			<div class="now"><span class="now-dot"></span><span>now</span></div>

			{#each view.redo as e, j (`r${j}`)}
				<button
					class="list-row entry future"
					onclick={() => onStep?.(j + 1)}
					title={`redo through ${e.pathDisplay}`}
				>
					<span class="bullet">○</span>
					<span class="lbl">{e.label}</span>
					<span class="path">{e.pathDisplay}</span>
				</button>
			{/each}
		</div>
		<div class="hint text-xs dim">click a past step to undo to it · a future step to redo</div>
	{/if}
</div>

<style>
	.empty {
		padding: var(--space-sm) var(--space-2xs);
		text-align: center;
	}
	.err {
		color: var(--danger);
	}

	.entry .bullet {
		flex-shrink: 0;
		font-size: var(--font-size-xs);
	}
	.entry.past {
		color: var(--text);
	}
	.entry.past .bullet {
		color: var(--text-dim);
	}
	.entry.future {
		color: var(--text-dim);
	}
	.entry.future .bullet {
		color: var(--text-faint);
	}
	.entry .lbl {
		flex-shrink: 0;
	}
	.entry .path {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--font-size-xs);
	}

	.now {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-md);
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		border-top: var(--rule-width) solid var(--rule);
		border-bottom: var(--rule-width) solid var(--rule);
		background: var(--accent-soft);
	}
	.now-dot {
		width: 6px;
		height: 6px;
		background: var(--accent);
	}

	.hint {
		flex-shrink: 0;
		padding: var(--space-xs) var(--space-sm);
		border-top: var(--rule-width) solid var(--rule);
	}
</style>
