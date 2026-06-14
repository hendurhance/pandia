<script lang="ts">
	import { docGetValue } from '$lib/ipc/doc';
	import type { DocHandle } from '$lib/ipc/types';
	import { stringifyWithOffsets } from '$lib/views/code/logic/highlights';
	import { fmtBytes } from '$lib/util/format';
	import { unifiedDiff, changeAnchors, changeCounts, type UnifiedRow } from '../logic/linediff';
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
		leftSourceSize: number;
		rightSourceSize: number;

		activeHunk: number;

		onMeta?: (meta: InlineMeta) => void;
	}

	let { leftHandle, rightHandle, leftSourceSize, rightSourceSize, activeHunk, onMeta }: Props =
		$props();

	const INLINE_MAX = 3 * 1024 * 1024;
	const tooBig = $derived(leftSourceSize > INLINE_MAX || rightSourceSize > INLINE_MAX);

	let rows: UnifiedRow[] = $state.raw([]);
	let anchors: number[] = $state.raw([]);
	let loading = $state(false);
	let error: string | null = $state(null);
	let scroller: HTMLDivElement | undefined = $state();

	const ROW_H = 22;
	const OVERSCAN = 8;
	let scrollTop = $state(0);
	let viewportHeight = $state(0);

	const win = $derived(fixedWindow(scrollTop, viewportHeight, rows.length, ROW_H, OVERSCAN));
	const startIndex = $derived(win.start);
	const endIndex = $derived(win.end);
	const visibleRows = $derived(rows.slice(startIndex, endIndex));
	const totalHeight = $derived(rows.length * ROW_H);

	const maxTextLen = $derived.by(() => {
		let m = 0;
		for (const r of rows) {
			if (r.type !== 'gap' && r.text.length > m) m = r.text.length;
		}
		return m;
	});

	const tokenized = $derived.by((): (Token[] | null)[] =>
		rows.map((r) => (r.type === 'gap' ? null : tokenizeJsonLine(r.text))),
	);

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

	function reportMeta(rs: UnifiedRow[]) {
		if (!onMeta) return;
		const { adds, dels } = changeCounts(rs);
		onMeta({ hunks: changeAnchors(rs).length, addLines: adds, delLines: dels });
	}

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		if (tooBig) {
			rows = [];
			anchors = [];
			reportMeta([]);
			return;
		}
		let cancelled = false;
		loading = true;
		error = null;
		void Promise.all([docGetValue(l, []), docGetValue(r, [])])
			.then(([lv, rv]) => {
				if (cancelled) return;
				const lt = stringifyWithOffsets(lv).text;
				const rt = stringifyWithOffsets(rv).text;
				const computed = unifiedDiff(lt, rt);
				rows = computed;
				anchors = changeAnchors(computed);
				reportMeta(computed);
			})
			.catch((e) => {
				if (!cancelled) {
					error = String(e);
					rows = [];
					anchors = [];
					reportMeta([]);
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
		if (r.type !== 'gap') return;
		const next = rows.slice();
		next.splice(rowIndex, 1, ...r.lines);
		rows = next;
		anchors = changeAnchors(next);
		reportMeta(next);
	}

	$effect(() => {
		const idx = activeHunk;
		if (!scroller || idx < 0 || idx >= anchors.length) return;
		const targetY = anchors[idx] * ROW_H;
		const center = Math.max(0, viewportHeight / 2 - ROW_H / 2);
		scroller.scrollTo({ top: Math.max(0, targetY - center), behavior: 'smooth' });
	});
</script>

{#if tooBig}
	<div class="empty-state">
		<div class="empty-state-inner">
			<div class="label">inline diff unavailable</div>
			<p class="dim text-sm">
				one side is {fmtBytes(Math.max(leftSourceSize, rightSourceSize))} — inline diff is capped at
				{fmtBytes(INLINE_MAX)} per side.
			</p>
			<p class="dim text-sm">
				switch to side-by-side: it diffs in Rust and streams slices regardless of size.
			</p>
		</div>
	</div>
{:else if loading}
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
					{@const toks = tokenized[i]}
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
							{:else}{row.text}{/if}
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
	.tok-text {
		color: inherit;
	}

	.err {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
</style>
