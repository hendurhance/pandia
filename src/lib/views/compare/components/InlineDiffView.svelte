<script lang="ts">
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
	import { PagedSource } from '$lib/views/shared/paged-source.svelte';
	import { WindowedScroller } from '$lib/views/shared/windowed-scroller.svelte';
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

	const ROW_H = 22;
	let lastScrolledHunk = -1;

	function rowIdentity(r: UnifiedRow): string {
		return r.type === 'gap'
			? `gap:${r.leftStart}:${r.rightStart}:${r.count}`
			: `${r.type}:${r.leftNo}:${r.rightNo}`;
	}

	const s = new WindowedScroller({
		rowCount: () => rows.length,
		rowHeight: ROW_H,
		overscan: 8,
		keyAt: (i) => {
			const r = rows[i];
			return r ? rowIdentity(r) : '';
		},
	});
	const startIndex = $derived(s.window.start);
	const endIndex = $derived(s.window.end);
	const visibleRows = $derived(rows.slice(startIndex, endIndex));
	const totalHeight = $derived(s.totalHeight);

	let maxTextLen = $state(0);

	function makeSource(handle: () => DocHandle): PagedSource<string> {
		return new PagedSource<string>({
			pageSize: 500,
			fetch: async (start, end) => {
				const lines = await ipc.docGetLines(handle(), start, end);
				for (const line of lines) {
					if (line.length > maxTextLen) maxTextLen = line.length;
				}
				return { items: lines };
			},
			onError: (e) => {
				error = describeError(e);
			},
		});
	}
	const leftSource = makeSource(() => leftHandle);
	const rightSource = makeSource(() => rightHandle);

	function textFor(row: DiffRow): string | null {
		const source = row.type === 'add' ? rightSource : leftSource;
		const no = row.type === 'add' ? row.rightNo : row.leftNo;
		return no == null ? null : (source.get(no - 1) ?? null);
	}

	const tokenized = $derived.by((): (Token[] | null)[] => {
		return visibleRows.map((r) => {
			if (r.type === 'gap') return null;
			const text = textFor(r);
			return text == null ? null : tokenizeJsonLine(text);
		});
	});

	$effect(() => {
		for (const row of visibleRows) {
			if (row.type === 'gap') continue;
			if (row.type === 'add') {
				const line = (row.rightNo ?? 1) - 1;
				rightSource.ensureVisible(line, line + 1);
			} else {
				const line = (row.leftNo ?? 1) - 1;
				leftSource.ensureVisible(line, line + 1);
			}
		}
	});

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		let cancelled = false;
		loading = true;
		error = null;
		leftSource.reset();
		rightSource.reset();
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
	}

	$effect(() => {
		const idx = activeHunk;
		if (!s.el || idx < 0 || idx >= anchors.length) return;
		if (idx === lastScrolledHunk) return;
		const anchor = anchors[idx];
		if (anchor === undefined) return;
		lastScrolledHunk = idx;
		s.scrollToIndex(anchor, { align: 'center' });
	});
</script>

{#if loading}
	<div class="empty-state"><div class="dim text-sm">Computing diff…</div></div>
{:else if error}
	<div class="empty-state"><div class="err">{error}</div></div>
{:else if rows.length === 0}
	<div class="empty-state"><div class="dim text-sm">No differences</div></div>
{:else}
	<div class="inline-scroller" use:s.attach>
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
						style="top: {s.offsetAt(i)}px; height: {ROW_H}px;"
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
						style="top: {s.offsetAt(i)}px; height: {ROW_H}px;"
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
