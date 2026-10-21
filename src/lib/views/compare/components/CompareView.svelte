<script lang="ts">
	import { untrack } from 'svelte';
	import CodeView from '$lib/views/code/CodeView.svelte';
	import InlineDiffView from './InlineDiffView.svelte';
	import CompareTree from './CompareTree.svelte';
	import { highlightsForSide } from '$lib/views/code/logic/highlights';
	import { ipc } from '$lib/ipc/client';
	import { describeError } from '$lib/ipc/error-copy';
	import type { DiffEntry, DiffKind, DocHandle, Path } from '$lib/ipc/bindings';
	import { pathToString, truncatePathMiddle } from '$lib/util/path';
	import { pathKey } from '$lib/views/tree/logic/model';
	import { createSyncScrollPair } from '$lib/ui/sync-scroll';
	import Icon from '$lib/ui/Icon.svelte';
	import { ArrowDownUp } from '@lucide/svelte';

	interface Props {
		leftHandle: DocHandle;
		rightHandle: DocHandle;
		leftSourceSize: number;
		rightSourceSize: number;
		leftName: string;
		rightName: string;
		leftVersion: number;
		rightVersion: number;

		staleSource?: boolean;

		onExit?: () => void;
	}

	let {
		leftHandle,
		rightHandle,
		leftSourceSize,
		rightSourceSize,
		leftName,
		rightName,
		leftVersion,
		rightVersion,
		staleSource = false,
		onExit,
	}: Props = $props();

	let entries: DiffEntry[] = $state.raw([]);
	let loading = $state(false);
	let error: string | null = $state(null);
	let activeIndex = $state(-1);
	let entriesEl: HTMLDivElement | undefined = $state();

	let mode = $state<'split' | 'inline' | 'tree'>('split');
	let activeHunk = $state(0);
	let inlineHunkCount = $state(0);
	let inlineLineCounts = $state<{ adds: number; dels: number }>({ adds: 0, dels: 0 });
	function onInlineMeta(meta: { hunks: number; addLines: number; delLines: number }) {
		inlineHunkCount = meta.hunks;
		inlineLineCounts = { adds: meta.addLines, dels: meta.delLines };
		if (activeHunk >= meta.hunks) activeHunk = 0;
	}

	let syncScroll = $state(true);
	let centering = $state(false);
	const sync = createSyncScrollPair({ enabled: true });
	$effect(() => {
		sync.setEnabled(syncScroll && !centering);
	});

	function bindPane(side: 'left' | 'right', el: HTMLElement) {
		sync.bind(side, el);
		for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
			el.addEventListener(type, () => (centering = false), { passive: true });
		}
	}

	$effect(() => {
		return () => {
			sync.dispose();
		};
	});

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		void leftVersion;
		void rightVersion;
		const kept = untrack(() => entries[activeIndex]?.path);
		if (staleSource) {
			loading = false;
			error = null;
			entries = [];
			activeIndex = -1;
			activeHunk = 0;
			return;
		}
		let cancelled = false;
		const jobId = crypto.randomUUID();
		loading = true;
		error = null;
		entries = [];
		activeIndex = -1;
		activeHunk = 0;
		void ipc
			.docDiff(l, r, jobId)
			.then((es) => {
				if (!cancelled) {
					entries = es;
					const i = kept ? es.findIndex((e) => pathKey(e.path) === pathKey(kept)) : -1;
					if (es.length > 0) activeIndex = Math.max(i, 0);
				}
			})
			.catch((e) => {
				if (!cancelled) error = describeError(e);
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
			void ipc.cancelJob(jobId).catch(() => {});
		};
	});

	function kindGlyph(k: DiffEntry['kind']): string {
		switch (k) {
			case 'added':
				return '+';
			case 'removed':
				return '−';
			case 'changed':
				return '~';
			case 'moved':
				return '↔';
		}
	}

	function kindLabel(k: DiffEntry['kind']): string {
		return k;
	}

	function leftPathOf(e: DiffEntry): Path {
		return e.leftPath ?? e.path;
	}

	function entryPathDisplay(e: DiffEntry): string {
		if (e.kind !== 'moved') return pathToString(e.path);
		const parent = e.path.slice(0, -1);
		const parentStr = parent.length === 0 ? '$' : pathToString(parent);
		const fromIdx = leftPathOf(e)[e.path.length - 1];
		const toIdx = e.path[e.path.length - 1];
		return `${parentStr}[${fromIdx}→${toIdx}]`;
	}

	function selectEntry(i: number) {
		if (i < 0 || i >= entries.length) return;
		activeIndex = i;
		const el = entriesEl?.querySelector(`[data-i="${i}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function hunkStep(delta: number) {
		if (inlineHunkCount === 0) return;
		activeHunk = (activeHunk + delta + inlineHunkCount) % inlineHunkCount;
	}

	function prev() {
		if (mode === 'inline') return hunkStep(-1);
		if (entries.length === 0) return;
		selectEntry((activeIndex - 1 + entries.length) % entries.length);
	}
	function next() {
		if (mode === 'inline') return hunkStep(1);
		if (entries.length === 0) return;
		selectEntry((activeIndex + 1) % entries.length);
	}

	const navDisabled = $derived(mode === 'inline' ? inlineHunkCount === 0 : entries.length === 0);

	const leftHighlights = $derived(highlightsForSide(entries, 'left'));
	const rightHighlights = $derived(highlightsForSide(entries, 'right'));

	const leftDiff = $derived.by(() => {
		const m = new Map<string, DiffKind>();
		for (const e of entries) {
			if (e.kind === 'added') continue;
			m.set(pathKey(leftPathOf(e)), e.kind);
		}
		return m;
	});
	const rightDiff = $derived.by(() => {
		const m = new Map<string, DiffKind>();
		for (const e of entries) if (e.kind !== 'removed') m.set(pathKey(e.path), e.kind);
		return m;
	});
	const activePath = $derived<Path | null>(
		activeIndex >= 0 && activeIndex < entries.length ? (entries[activeIndex]?.path ?? null) : null,
	);
	$effect(() => {
		void activePath;
		centering = true;
	});

	let chPx = $state(0);
	let headW = $state(0);
	let syncW = $state(0);
	let inlineW = $state(0);

	function measureCh(el: HTMLElement) {
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) return;
		const cs = getComputedStyle(el);
		ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
		const w = ctx.measureText('0000000000').width / 10;
		if (w > 0) chPx = w;
	}

	const paneBudget = $derived(
		chPx > 0 && headW > 0 ? Math.max(8, Math.floor((headW - 16) / chPx) - 5) : Infinity,
	);
	const rightBudget = $derived(
		paneBudget === Infinity ? Infinity : Math.max(8, paneBudget - Math.ceil(syncW / chPx) - 1),
	);
	const inlineBudget = $derived(
		chPx > 0 && inlineW > 0 ? Math.max(8, Math.floor(((inlineW - 40) / chPx - 8) / 2)) : Infinity,
	);

	const summaryText = $derived.by(() => {
		if (loading) return 'computing diff…';
		if (error) return `error: ${error}`;
		const adds = entries.filter((e) => e.kind === 'added').length;
		const rems = entries.filter((e) => e.kind === 'removed').length;
		const chgs = entries.filter((e) => e.kind === 'changed').length;
		const mvs = entries.filter((e) => e.kind === 'moved').length;
		const inlineLines = mode === 'inline' ? inlineLineCounts.adds + inlineLineCounts.dels : 0;
		if (entries.length === 0 && inlineLines === 0) return 'no differences';
		const movePart = mvs > 0 ? ` ↔${mvs}` : '';
		const structural =
			entries.length > 0
				? `${entries.length} entries · +${adds} −${rems} ~${chgs}${movePart}`
				: 'no structural changes';
		if (mode === 'inline' && inlineLines > 0) {
			return `${structural} · ${inlineLineCounts.adds} added / ${inlineLineCounts.dels} removed lines`;
		}
		return structural;
	});
</script>

{#snippet syncToggle()}
	<button
		class="btn sync-toggle"
		class:btn-active={syncScroll}
		bind:clientWidth={syncW}
		onclick={() => (syncScroll = !syncScroll)}
		title="Sync scroll between panes"
		><Icon icon={ArrowDownUp} size="xs" /> Sync scroll{syncScroll ? ' · on' : ' · off'}</button
	>
{/snippet}

<div class="compare-root">
	<div class="navbar rule-b">
		<div class="seg" role="group" aria-label="Diff layout">
			<button
				class:active={mode === 'split'}
				onclick={() => (mode = 'split')}
				title="Side-by-side code panes">Side-by-side</button
			>
			<button
				class:active={mode === 'tree'}
				onclick={() => (mode = 'tree')}
				title="Side-by-side trees with diff highlights">Tree</button
			>
			<button
				class:active={mode === 'inline'}
				onclick={() => (mode = 'inline')}
				title="Unified single-column diff">Inline</button
			>
		</div>
		<button class="btn" onclick={prev} disabled={navDisabled} title="Previous diff">← Prev</button>
		<button class="btn" onclick={next} disabled={navDisabled} title="Next diff">Next →</button>
		<span class="dim text-sm counter">
			{#if mode === 'inline'}
				{#if inlineHunkCount > 0}#{activeHunk + 1} / {inlineHunkCount}{/if}
			{:else if mode === 'split' && activeIndex >= 0}#{activeIndex + 1} / {entries.length}{/if}
		</span>
		<span class="dim text-sm summary" title={summaryText}>{summaryText}</span>
	</div>

	{#if staleSource}
		<div class="stale-notice">
			<div class="stale-card">
				<div class="stale-title">Source tab was closed</div>
				<p class="stale-body">
					The tab this compare borrowed from is no longer open, so its document is gone. Pick a new
					compare target or exit this compare.
				</p>
				{#if onExit}
					<button class="stale-exit" onclick={() => onExit?.()}>Exit compare</button>
				{/if}
			</div>
		</div>
	{:else}
		{#if mode === 'inline'}
			<div class="inline-head rule-b" bind:clientWidth={inlineW}>
				<span class="dim text-sm file" use:measureCh title={leftName}
					>L · {truncatePathMiddle(leftName, inlineBudget)}</span
				>
				<span class="arrow-head" aria-hidden="true">→</span>
				<span class="dim text-sm file" title={rightName}
					>R · {truncatePathMiddle(rightName, inlineBudget)}</span
				>
			</div>
			<InlineDiffView
				{leftHandle}
				{rightHandle}
				{leftVersion}
				{rightVersion}
				{activeHunk}
				onMeta={onInlineMeta}
			/>
		{:else if mode === 'tree'}
			{@const activeEntry = activeIndex >= 0 ? entries[activeIndex] : undefined}
			<div class="split">
				<div class="pane">
					<div class="pane-head rule-b" bind:clientWidth={headW}>
						<span class="dim text-sm file" use:measureCh title={leftName}
							>L · {truncatePathMiddle(leftName, paneBudget)}</span
						>
					</div>
					<CompareTree
						handle={leftHandle}
						version={leftVersion}
						diff={leftDiff}
						activePath={activeEntry ? leftPathOf(activeEntry) : null}
						onScrollerReady={(el) => bindPane('left', el)}
					/>
				</div>
				<div class="divider"></div>
				<div class="pane">
					<div class="pane-head rule-b">
						<span class="dim text-sm file" title={rightName}
							>R · {truncatePathMiddle(rightName, rightBudget)}</span
						>
						{@render syncToggle()}
					</div>
					<CompareTree
						handle={rightHandle}
						version={rightVersion}
						diff={rightDiff}
						{activePath}
						onScrollerReady={(el) => bindPane('right', el)}
					/>
				</div>
			</div>
		{:else}
			{@const activeEntry = activeIndex >= 0 ? entries[activeIndex] : undefined}
			<div class="split">
				<div class="pane">
					<div class="pane-head rule-b" bind:clientWidth={headW}>
						<span class="dim text-sm file" use:measureCh title={leftName}
							>L · {truncatePathMiddle(leftName, paneBudget)}</span
						>
					</div>
					<CodeView
						handle={leftHandle}
						version={leftVersion}
						sourceSize={leftSourceSize}
						highlights={leftHighlights}
						activePath={activeEntry ? leftPathOf(activeEntry) : null}
						onScrollerReady={(el) => bindPane('left', el)}
					/>
				</div>
				<div class="divider"></div>
				<div class="pane">
					<div class="pane-head rule-b">
						<span class="dim text-sm file" title={rightName}
							>R · {truncatePathMiddle(rightName, rightBudget)}</span
						>
						{@render syncToggle()}
					</div>
					<CodeView
						handle={rightHandle}
						version={rightVersion}
						sourceSize={rightSourceSize}
						highlights={rightHighlights}
						{activePath}
						onScrollerReady={(el) => bindPane('right', el)}
					/>
				</div>
			</div>
		{/if}

		{#if mode === 'split' || mode === 'tree'}
			<div class="entries rule-t" bind:this={entriesEl}>
				{#if loading}
					<div class="dim text-sm empty-line">Computing diff…</div>
				{:else if error}
					<div class="err text-sm empty-line">{error}</div>
				{:else if entries.length === 0}
					<div class="dim text-sm empty-line">No differences</div>
				{:else}
					{#each entries as e, i (i)}
						<button
							class="entry"
							class:active={i === activeIndex}
							data-i={i}
							data-kind={e.kind}
							onclick={() => selectEntry(i)}
							title={`${kindLabel(e.kind)} ${pathToString(e.path)}`}
						>
							<span class="glyph" data-kind={e.kind}>{kindGlyph(e.kind)}</span>
							<span class="path">{entryPathDisplay(e)}</span>
							<span class="preview">
								{#if e.kind === 'moved'}
									<span class="right">{e.leftPreview ?? ''}</span>
								{:else}
									{#if e.leftPreview !== null}<span class="left">{e.leftPreview}</span>{/if}
									{#if e.leftPreview !== null && e.rightPreview !== null}<span class="arrow">→</span
										>{/if}
									{#if e.rightPreview !== null}<span class="right">{e.rightPreview}</span>{/if}
								{/if}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.compare-root {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
		font-family: var(--font-mono);
		color: var(--text);
	}

	.navbar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elev);
		min-width: 0;
		overflow: hidden;
	}
	.navbar > * {
		white-space: nowrap;
		flex-shrink: 0;
	}
	.navbar button {
		font-size: var(--font-size-sm);
		padding: var(--space-2xs) var(--space-sm);
	}
	.summary {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.counter {
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}
	.counter:empty {
		display: none;
	}
	.err {
		color: var(--danger);
	}

	.stale-notice {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-lg);
		background: var(--bg);
	}
	.stale-card {
		max-width: 460px;
		padding: var(--space-lg);
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-left: 3px solid var(--warning);
		border-radius: 4px;
		color: var(--text);
	}
	.stale-title {
		font-size: var(--font-size-base);
		font-weight: 700;
		color: var(--text);
		margin-bottom: var(--space-sm);
	}
	.stale-body {
		font-size: var(--font-size-sm);
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0 0 var(--space-md) 0;
	}
	.stale-exit {
		font-size: var(--font-size-sm);
		letter-spacing: 0.08em;
		padding: var(--space-xs) var(--space-md);
		background: transparent;
		border: 1px solid var(--rule-2);
		color: var(--text);
		cursor: pointer;
	}
	.stale-exit:hover {
		background: var(--bg-elev-2);
	}

	.sync-toggle {
		flex-shrink: 0;
		margin-left: auto;
		padding-block: 0;
		/* Cancels the border so the right header matches the left one's height and the panes' lines stay aligned. */
		margin-block: calc(-1 * var(--rule-width));
	}

	.inline-head {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elev);
		white-space: nowrap;
		overflow: hidden;
	}
	.arrow-head {
		color: var(--text-faint);
		flex-shrink: 0;
	}
	.file {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.split {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1px 1fr;
		min-height: 0;
	}
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.pane-head {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		background: var(--bg-elev);
		white-space: nowrap;
		overflow: hidden;
	}
	.rule-b {
		border-bottom: 1px solid var(--rule);
	}
	.rule-t {
		border-top: 1px solid var(--rule);
	}
	.divider {
		background: var(--rule);
	}

	.entries {
		flex: 0 0 auto;
		max-height: 28vh;
		overflow-y: auto;
		background: var(--bg-elev);
	}
	.empty-line {
		padding: var(--space-sm);
	}

	.entry {
		display: grid;
		grid-template-columns: 18px minmax(180px, 1fr) 2fr;
		gap: var(--space-sm);
		align-items: center;
		width: 100%;
		text-align: left;
		padding: var(--space-2xs) var(--space-sm);
		font-size: var(--font-size-sm);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--rule);
		color: var(--text);
		cursor: pointer;
	}
	.entry:hover {
		background: var(--bg-elev-2);
	}
	.entry.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.glyph {
		font-weight: 700;
		text-align: center;
	}
	.glyph[data-kind='added'] {
		color: var(--success);
	}
	.glyph[data-kind='removed'] {
		color: var(--danger);
	}
	.glyph[data-kind='changed'] {
		color: var(--warning);
	}
	.glyph[data-kind='moved'] {
		color: var(--syntax-boolean);
	}

	.path {
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.preview {
		display: flex;
		gap: var(--space-xs);
		align-items: center;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
	}
	.preview .left,
	.preview .right {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 28ch;
	}
	.preview .arrow {
		color: var(--text-faint);
	}
</style>
