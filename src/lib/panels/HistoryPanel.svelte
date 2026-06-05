<script lang="ts">
	import { docHistory } from '$lib/ipc/doc';
	import type { DocHandle, HistoryView } from '$lib/ipc/types';

	interface Context {
		handle: DocHandle;
		version: number;
		sourceName: string | null;
	}

	interface Props {
		context: Context | null;
		
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
			return;
		}
		const key = `${ctx.handle}@${ctx.version}`;
		if (key === loadedKey) return;
		loadedKey = key;
		void docHistory(ctx.handle)
			.then((v) => {
				if (loadedKey === key) {
					view = v;
					error = null;
				}
			})
			.catch((e) => {
				if (loadedKey === key) error = String(e);
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
		padding: 0.6rem 0.2rem;
		text-align: center;
	}
	.err {
		color: var(--accent);
	}

	.entry .bullet {
		flex-shrink: 0;
		font-size: 8px;
	}
	.entry.past {
		color: var(--text);
	}
	.entry.past .bullet {
		color: var(--accent);
	}
	.entry.future {
		color: var(--text-faint);
	}
	.entry.future .bullet {
		color: var(--text-faint);
	}
	.entry .lbl {
		flex-shrink: 0;
	}
	.entry .path {
		color: var(--accent-2);
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 10.5px;
	}
	.entry.future .path {
		color: var(--text-ghost);
	}

	.now {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-size: 9.5px;
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
		padding: 0.4rem 0.5rem;
		border-top: var(--rule-width) solid var(--rule);
	}
</style>
