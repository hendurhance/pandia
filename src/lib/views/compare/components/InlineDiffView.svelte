<script lang="ts">
	import { tick } from 'svelte';
	import { ipc } from '$lib/ipc/client';
	import { describeError } from '$lib/ipc/error-copy';
	import type { DocHandle } from '$lib/ipc/bindings';
	import {
		unifiedRows,
		gapRows,
		changeAnchors,
		changeCounts,
		type DiffRow,
		type UnifiedRow,
	} from '../logic/linediff';
	import { fixedWindow } from '$lib/views/tree/logic/virtualizer';
	import { tokenizeJsonLine, type Token } from '../logic/json-tokens';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronsUpDown } from '@lucide/svelte';

	export interface InlineMeta {
		hunks: number;
		addLines: number;
		delLines: number;
	}

	interface Props {
		leftHandle: DocHandle;
		rightHandle: DocHandle;

		activeHunk: number;

		onMeta?: (meta: InlineMeta) => void;
	}

	let { leftHandle, rightHandle, activeHunk, onMeta }: Props = $props();

	let rows: UnifiedRow[] = $state.raw([]);
	let anchors: number[] = $state.raw([]);
	let loading = $state(false);
	let error: string | null = $state(null);
	let scroller: HTMLDivElement | undefined = $state();

	const ROW_H = 22;
	const OVERSCAN = 8;
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	let lastScrolledHunk = -1;

	const win = $derived(fixedWindow(scrollTop, viewportHeight, rows.length, ROW_H, OVERSCAN));
	const startIndex = $derived(win.start);
	const endIndex = $derived(win.end);
	const visibleRows = $derived(rows.slice(startIndex, endIndex));
	const totalHeight = $derived(rows.length * ROW_H);

	const BLOCK = 500;
	let leftBlocks = new Map<number, string[]>();
	let rightBlocks = new Map<number, string[]>();
	let pendingBlocks = new Set<string>();
	let fetchedVersion = $state(0);
	let maxTextLen = $state(0);

	function textFor(row: DiffRow): string | null {
		const blocks = row.type === 'add' ? rightBlocks : leftBlocks;
		const line = (row.type === 'add' ? row.rightNo! : row.leftNo!) - 1;
		return blocks.get(Math.floor(line / BLOCK))?.[line % BLOCK] ?? null;
	}

	const tokenized = $derived.by((): (Token[] | null)[] => {
		void fetchedVersion;
		return visibleRows.map((r) => {
			if (r.type === 'gap') return null;
			const text = textFor(r);
			return text == null ? null : tokenizeJsonLine(text);
		});
	});

	function fetchBlock(handle: DocHandle, side: 'left' | 'right', block: number) {
		const blocks = side === 'left' ? leftBlocks : rightBlocks;
		const key = `${side}:${block}`;
		if (blocks.has(block) || pendingBlocks.has(key)) return;
		pendingBlocks.add(key);
		void ipc
			.docGetLines(handle, block * BLOCK, (block + 1) * BLOCK)
			.then((lines) => {
				const current = side === 'left' ? leftBlocks : rightBlocks;
				if (blocks !== current) return;
				blocks.set(block, lines);
				for (const line of lines) {
					if (line.length > maxTextLen) maxTextLen = line.length;
				}
				fetchedVersion++;
			})
			.catch((e) => {
				if (blocks !== (side === 'left' ? leftBlocks : rightBlocks)) return;
				error = describeError(e);
			})
			.finally(() => {
				pendingBlocks.delete(key);
			});
	}

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		for (const row of visibleRows) {
			if (row.type === 'gap') continue;
			if (row.type === 'add') {
				fetchBlock(r, 'right', Math.floor((row.rightNo! - 1) / BLOCK));
			} else {
				fetchBlock(l, 'left', Math.floor((row.leftNo! - 1) / BLOCK));
			}
		}
	});

	function onScroll(e: Event) {
		scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
	}

	$effect(() => {
		if (!scroller) return;
		const sync = () => {
			if (scroller) viewportHeight = scroller.clientHeight;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(scroller);
		return () => ro.disconnect();
	});

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		let cancelled = false;
		loading = true;
		error = null;
		leftBlocks = new Map();
		rightBlocks = new Map();
		pendingBlocks = new Set();
		maxTextLen = 0;
		void ipc
			.docDiffLines(l, r, null)
			.then((d) => {
				if (cancelled) return;
				const computed = unifiedRows(d);
				rows = computed;
				anchors = changeAnchors(computed);
				lastScrolledHunk = -1;
				const { adds, dels } = changeCounts(d.hunks);
				onMeta?.({ hunks: anchors.length, addLines: adds, delLines: dels });
			})
			.catch((e) => {
				if (!cancelled) {
					error = describeError(e);
					rows = [];
					anchors = [];
					onMeta?.({ hunks: 0, addLines: 0, delLines: 0 });
				}
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	function expandGap(rowIndex: number) {
		const r = rows[rowIndex];
		if (!r || r.type !== 'gap') return;
		const expanded = gapRows(r);
		const next = rows.slice(0, rowIndex).concat(expanded, rows.slice(rowIndex + 1));
		rows = next;
		anchors = changeAnchors(next);
		if (rowIndex >= Math.ceil(scrollTop / ROW_H)) return;
		const top = scrollTop + (expanded.length - 1) * ROW_H;
		void tick().then(() => {
			if (!scroller) return;
			scroller.scrollTop = top;
			scrollTop = top;
		});
	}

	$effect(() => {
		const idx = activeHunk;
		if (!scroller || idx < 0 || idx >= anchors.length) return;
		if (idx === lastScrolledHunk) return;
		const anchor = anchors[idx];
		if (anchor === undefined) return;
		lastScrolledHunk = idx;
		const targetY = anchor * ROW_H;
		const center = Math.max(0, viewportHeight / 2 - ROW_H / 2);
		scroller.scrollTo({ top: Math.max(0, targetY - center), behavior: 'smooth' });
	});
</script>

{#if loading}
	<div class="empty-state"><div class="dim text-sm">Computing diff…</div></div>
{:else if error}
	<div class="empty-state"><div class="err">{error}</div></div>
{:else if rows.length === 0}
	<div class="empty-state"><div class="dim text-sm">No differences</div></div>
{:else}
	<div class="inline-scroller" bind:this={scroller} onscroll={onScroll}>
		<div
			class="spacer"
			style="height: {totalHeight}px; width: max(100%, calc({maxTextLen + 14}ch));"
		>
			{#each visibleRows as row, j (startIndex + j)}
				{@const i = startIndex + j}
				{#if row.type === 'gap'}
					<button
						class="row gap"
						data-row={i}
						style="top: {i * ROW_H}px; height: {ROW_H}px;"
						onclick={() => expandGap(i)}
						title="Click to expand"
					>
						<span class="gap-label">
							<Icon icon={ChevronsUpDown} size="xs" />
							{row.count} unchanged line{row.count === 1 ? '' : 's'} · click to expand</span
						>
					</button>
				{:else}
					{@const toks = tokenized[j]}
					<div
						class="row"
						data-kind={row.type}
						data-row={i}
						style="top: {i * ROW_H}px; height: {ROW_H}px;"
					>
						<span class="ln">{row.leftNo ?? ''}</span>
						<span class="ln">{row.rightNo ?? ''}</span>
						<span class="sign" aria-hidden="true"
							>{row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</span
						>
						<span class="text">
							{#if toks}
								{#each toks as t, k (k)}<span class="tok-{t.kind}">{t.text}</span>{/each}
							{:else}
								<span class="tok-pending" aria-label="loading line">····</span>
							{/if}
						</span>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.inline-scroller {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: auto;
		background: var(--bg);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}
	.spacer {
		position: relative;
		min-width: 100%;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
	}
	.ln {
		flex: 0 0 auto;
		width: 5ch;
		padding: 0 0.5ch;
		text-align: right;
		color: var(--text-faint);
		background: var(--bg-elev);
		border-right: 1px solid var(--rule);
		user-select: none;
	}
	.sign {
		flex: 0 0 auto;
		width: 2ch;
		text-align: center;
		color: var(--text-faint);
		user-select: none;
	}
	.text {
		flex: 1;
		padding-right: 1ch;
		color: var(--text);
		white-space: pre;
	}

	.row[data-kind='add'] {
		background: rgba(123, 166, 136, 0.14);
	}
	.row[data-kind='add'] .sign {
		color: var(--success);
	}
	.row[data-kind='del'] {
		background: var(--accent-soft);
	}
	.row[data-kind='del'] .sign {
		color: var(--accent);
	}
	.row[data-kind='add'] .ln {
		background: rgba(123, 166, 136, 0.12);
	}
	.row[data-kind='del'] .ln {
		background: var(--accent-soft);
	}

	.row.gap {
		background: var(--bg-elev);

		box-shadow:
			inset 0 1px 0 var(--rule),
			inset 0 -1px 0 var(--rule);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		border: none;
	}
	.row.gap:hover {
		background: var(--bg-elev-2);
	}
	.row.gap:hover .gap-label {
		color: var(--accent);
	}
	.gap-label {
		padding: 0.1rem 1ch 0.1rem 11ch;
		color: var(--text-faint);
		font-size: var(--font-size-xs);
		letter-spacing: 0.04em;
		user-select: none;
	}

	.tok-string {
		color: var(--syntax-string);
	}
	.tok-number {
		color: var(--syntax-number);
	}
	.tok-keyword {
		color: var(--syntax-boolean);
	}
	.tok-key {
		color: var(--text);
	}
	.tok-punct {
		color: var(--syntax-punct);
	}
	.tok-pending {
		color: var(--text-ghost);
		letter-spacing: 0.15em;
	}

	.tok-text {
		color: inherit;
	}

	.err {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
</style>
