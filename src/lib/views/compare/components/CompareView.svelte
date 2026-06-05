<script lang="ts">
	import CodeView from '$lib/views/code/CodeView.svelte';
	import InlineDiffView from './InlineDiffView.svelte';
	import CompareTree from './CompareTree.svelte';
	import { highlightsForSide } from '$lib/views/code/logic/highlights';
	import { docDiff } from '$lib/ipc/doc';
	import type { DiffEntry, DiffKind, DocHandle, Path } from '$lib/ipc/types';
	import { pathToString } from '$lib/util/path';
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
		staleSource = false,
		onExit,
	}: Props = $props();

	let entries: DiffEntry[] = $state([]);
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
	const sync = createSyncScrollPair({ enabled: true });
	$effect(() => {
		sync.setEnabled(syncScroll);
	});

	$effect(() => {
		return () => {
			sync.dispose();
		};
	});

	$effect(() => {
		const l = leftHandle;
		const r = rightHandle;
		if (staleSource) {
			loading = false;
			error = null;
			entries = [];
			activeIndex = -1;
			activeHunk = 0;
			return;
		}
		loading = true;
		error = null;
		entries = [];
		activeIndex = -1;
		activeHunk = 0;
		void docDiff(l, r)
			.then((es) => {
				if (leftHandle === l && rightHandle === r) {
					entries = es;
					if (es.length > 0) activeIndex = 0;
				}
			})
			.catch((e) => {
				if (leftHandle === l && rightHandle === r) error = String(e);
			})
			.finally(() => {
				if (leftHandle === l && rightHandle === r) loading = false;
			});
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
		if (e.kind !== 'moved' || e.fromIndex === undefined) return e.path;
		return [...e.path.slice(0, -1), e.fromIndex];
	}

	
	function entryPathDisplay(e: DiffEntry): string {
		if (e.kind !== 'moved' || e.fromIndex === undefined) return pathToString(e.path);
		const parent = e.path.slice(0, -1);
		const parentStr = parent.length === 0 ? '$' : pathToString(parent);
		const toIdx = e.path[e.path.length - 1];
		return `${parentStr}[${e.fromIndex}→${toIdx}]`;
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
	const leftDiffPaths = $derived(
		entries.filter((e) => e.kind !== 'added').map((e) => leftPathOf(e)),
	);
	const rightDiffPaths = $derived(entries.filter((e) => e.kind !== 'removed').map((e) => e.path));
	const activePath = $derived<Path | null>(
		activeIndex >= 0 && activeIndex < entries.length ? entries[activeIndex].path : null,
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

<div class="compare-root">
	<div class="navbar rule-b">
		<button onclick={prev} disabled={navDisabled} title="Previous diff">← Prev</button>
		<button onclick={next} disabled={navDisabled} title="Next diff">Next →</button>
		<span class="dim text-sm">{summaryText}</span>
		<div class="grow"></div>
		<div class="mode-seg" role="group" aria-label="Diff layout">
			<button
				class:on={mode === 'split'}
				onclick={() => (mode = 'split')}
				title="Side-by-side code panes">Side-by-side</button
			>
			<button
				class:on={mode === 'tree'}
				onclick={() => (mode = 'tree')}
				title="Side-by-side trees with diff highlights">Tree</button
			>
			<button
				class:on={mode === 'inline'}
				onclick={() => (mode = 'inline')}
				title="Unified single-column diff">Inline</button
			>
		</div>
		{#if mode === 'split' || mode === 'tree'}
			<button
				class="sync-toggle"
				class:on={syncScroll}
				onclick={() => (syncScroll = !syncScroll)}
				title="Sync scroll between panes"
				><Icon icon={ArrowDownUp} size="xs" /> Sync scroll{syncScroll ? ' · on' : ' · off'}</button
			>
		{/if}
		<span class="dim text-sm">
			{#if mode === 'inline'}
				{#if inlineHunkCount > 0}#{activeHunk + 1} / {inlineHunkCount}{/if}
			{:else if mode === 'split' && activeIndex >= 0}#{activeIndex + 1} / {entries.length}{/if}
		</span>
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
			<div class="inline-head rule-b">
				<span class="dim text-sm">L · {leftName}</span>
				<span class="arrow-head" aria-hidden="true">→</span>
				<span class="dim text-sm">R · {rightName}</span>
			</div>
			<InlineDiffView
				{leftHandle}
				{rightHandle}
				{leftSourceSize}
				{rightSourceSize}
				{activeHunk}
				onMeta={onInlineMeta}
			/>
		{:else if mode === 'tree'}
			<div class="split">
				<div class="pane">
					<div class="pane-head rule-b"><span class="dim text-sm">L · {leftName}</span></div>
					<CompareTree
						handle={leftHandle}
						diff={leftDiff}
						diffPaths={leftDiffPaths}
						activePath={activeIndex >= 0 ? leftPathOf(entries[activeIndex]) : null}
						onScrollerReady={(el) => sync.bind('left', el)}
					/>
				</div>
				<div class="divider"></div>
				<div class="pane">
					<div class="pane-head rule-b"><span class="dim text-sm">R · {rightName}</span></div>
					<CompareTree
						handle={rightHandle}
						diff={rightDiff}
						diffPaths={rightDiffPaths}
						{activePath}
						onScrollerReady={(el) => sync.bind('right', el)}
					/>
				</div>
			</div>
		{:else}
			<div class="split">
				<div class="pane">
					<div class="pane-head rule-b">
						<span class="dim text-sm">L · {leftName}</span>
					</div>
					<CodeView
						handle={leftHandle}
						sourceSize={leftSourceSize}
						highlights={leftHighlights}
						{activePath}
						onScrollerReady={(el) => sync.bind('left', el)}
					/>
				</div>
				<div class="divider"></div>
				<div class="pane">
					<div class="pane-head rule-b">
						<span class="dim text-sm">R · {rightName}</span>
					</div>
					<CodeView
						handle={rightHandle}
						sourceSize={rightSourceSize}
						highlights={rightHighlights}
						{activePath}
						onScrollerReady={(el) => sync.bind('right', el)}
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
									{#if e.leftPreview !== undefined}<span class="left">{e.leftPreview}</span>{/if}
									{#if e.leftPreview !== undefined && e.rightPreview !== undefined}<span
											class="arrow">→</span
										>{/if}
									{#if e.rightPreview !== undefined}<span class="right">{e.rightPreview}</span>{/if}
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
		gap: 0.6rem;
		padding: 0.3rem 0.75rem;
		background: var(--bg-elev);
	}
	.navbar button {
		font-size: 11px;
		padding: 0.15rem 0.6rem;
	}
	.err {
		color: var(--accent);
	}

	
	.stale-notice {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: var(--bg);
	}
	.stale-card {
		max-width: 460px;
		padding: 1.25rem 1.5rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		border-left: 3px solid var(--accent);
		border-radius: 4px;
		color: var(--text);
	}
	.stale-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--accent);
		margin-bottom: 0.5rem;
	}
	.stale-body {
		font-size: 12px;
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0 0 1rem 0;
	}
	.stale-exit {
		font-size: 11px;
		letter-spacing: 0.08em;
		padding: 0.25rem 0.8rem;
		background: transparent;
		border: 1px solid var(--rule-2);
		color: var(--text);
		cursor: pointer;
	}
	.stale-exit:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.sync-toggle {
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.15rem 0.6rem;
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		color: var(--text-faint);
	}
	.sync-toggle:hover {
		color: var(--text-dim);
	}
	.sync-toggle.on {
		color: var(--accent);
		border-color: var(--accent-line);
	}

	
	.mode-seg {
		display: flex;
	}
	.mode-seg button {
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		padding: 0.15rem 0.6rem;
		background: transparent;
		border: var(--rule-width) solid var(--rule);
		color: var(--text-faint);
	}
	.mode-seg button:not(:last-child) {
		border-right: none;
	}
	.mode-seg button:hover {
		color: var(--text-dim);
	}
	.mode-seg button.on {
		color: var(--accent);
		border-color: var(--accent-line);
	}

	
	.inline-head {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.6rem;
		background: var(--bg-elev);
	}
	.arrow-head {
		color: var(--text-faint);
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
		padding: 0.25rem 0.6rem;
		background: var(--bg-elev);
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
		padding: 0.5rem 0.75rem;
	}

	.entry {
		display: grid;
		grid-template-columns: 18px minmax(180px, 1fr) 2fr;
		gap: 0.6rem;
		align-items: center;
		width: 100%;
		text-align: left;
		padding: 0.2rem 0.75rem;
		font-size: 12px;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--rule);
		color: var(--text);
		cursor: pointer;
	}
	.entry:hover {
		background: rgba(255, 255, 255, 0.02);
	}
	.entry.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.glyph {
		font-weight: 600;
		text-align: center;
	}
	.glyph[data-kind='added'] {
		color: var(--success);
	}
	.glyph[data-kind='removed'] {
		color: var(--accent);
	}
	.glyph[data-kind='changed'] {
		color: var(--warning);
	}
	.glyph[data-kind='moved'] {
		color: var(--mauve);
	}

	.path {
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.preview {
		display: flex;
		gap: 0.4rem;
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
