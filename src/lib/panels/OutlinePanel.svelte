<script lang="ts">
	import { docGetSlice } from '$lib/ipc/doc';
	import type { DocHandle, NodeView, Path } from '$lib/ipc/types';
	import { pathToString } from '$lib/util/path';
	import { fixedWindow } from '$lib/views/tree/logic/virtualizer';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';

	interface Context {
		handle: DocHandle;
		version: number;
		sourceName: string | null;
	}

	interface Props {
		context: Context | null;

		onNavigate?: (path: Path) => void;
	}

	let { context, onNavigate }: Props = $props();

	const PER_LEVEL = 200;

	interface ONode {
		path: Path;
		key: string | number;
		kind: NodeView['kind'];
		childCount: number | null;
		depth: number;
		expanded: boolean;
		children: ONode[] | null; // null = not yet fetched
		more: boolean; // more children exist beyond what's loaded (paged)
	}

	type RenderRow =
		| { type: 'node'; node: ONode }
		| { type: 'more'; parent: ONode | null; depth: number; loaded: number };

	let roots: ONode[] = $state([]);
	let rootsMore = $state(false); // top level has more than what's loaded
	let loading = $state(false);
	let error: string | null = $state(null);
	let loadedVersion = $state(-1);
	let loadedHandle: DocHandle | null = null;

	function nodeFromView(v: NodeView, parent: Path, depth: number): ONode {
		return {
			path: [...parent, v.key],
			key: v.key,
			kind: v.kind,
			childCount: v.childCount,
			depth,
			expanded: false,
			children: null,
			more: false,
		};
	}

	function expandable(n: ONode): boolean {
		return (n.kind === 'object' || n.kind === 'array') && (n.childCount ?? 0) > 0;
	}

	async function fetchRange(path: Path, depth: number, start: number): Promise<ONode[]> {
		if (!context) return [];
		const views = await docGetSlice(context.handle, path, start, start + PER_LEVEL);
		return views.map((v) => nodeFromView(v, path, depth));
	}

	$effect(() => {
		const ctx = context;
		if (!ctx) {
			roots = [];
			rootsMore = false;
			return;
		}
		if (loadedHandle === ctx.handle && loadedVersion === ctx.version) return;
		loadedHandle = ctx.handle;
		loadedVersion = ctx.version;
		loading = true;
		error = null;
		void fetchRange([], 1, 0)
			.then((children) => {
				if (loadedHandle === ctx.handle && loadedVersion === ctx.version) {
					roots = children;
					rootsMore = children.length === PER_LEVEL;
				}
			})
			.catch((e) => {
				if (loadedHandle === ctx.handle) error = String(e);
			})
			.finally(() => {
				if (loadedHandle === ctx.handle) loading = false;
			});
	});

	async function toggle(n: ONode) {
		if (!expandable(n)) {
			onNavigate?.(n.path);
			return;
		}
		if (n.expanded) {
			n.expanded = false;
			roots = roots; // trip reactivity (mutated nested $state)
			return;
		}
		if (n.children === null) {
			try {
				const children = await fetchRange(n.path, n.depth + 1, 0);
				n.children = children;
				n.more = children.length === PER_LEVEL;
			} catch (e) {
				error = String(e);
				return;
			}
		}
		n.expanded = true;
		roots = roots;
	}

	async function loadMore(parent: ONode | null, loaded: number) {
		const path = parent ? parent.path : [];
		const depth = parent ? parent.depth + 1 : 1;
		try {
			const next = await fetchRange(path, depth, loaded);
			if (parent) {
				parent.children = [...(parent.children ?? []), ...next];
				parent.more = next.length === PER_LEVEL;
			} else {
				roots = [...roots, ...next];
				rootsMore = next.length === PER_LEVEL;
			}
			roots = roots;
		} catch (e) {
			error = String(e);
		}
	}

	function glyph(n: ONode): string {
		if (n.kind === 'object') return '{}';
		if (n.kind === 'array') return '[]';
		return 'a';
	}

	function label(n: ONode): string {
		return typeof n.key === 'number' ? `[${n.key}]` : String(n.key);
	}

	function flatten(nodes: ONode[], out: RenderRow[]) {
		for (const n of nodes) {
			out.push({ type: 'node', node: n });
			if (n.expanded && n.children) {
				flatten(n.children, out);
				if (n.more) {
					out.push({ type: 'more', parent: n, depth: n.depth + 1, loaded: n.children.length });
				}
			}
		}
	}
	const rows = $derived.by(() => {
		const out: RenderRow[] = [];
		flatten(roots, out);
		if (rootsMore) out.push({ type: 'more', parent: null, depth: 1, loaded: roots.length });
		return out;
	});

	function rowKey(r: RenderRow): string {
		return r.type === 'node'
			? 'n:' + pathToString(r.node.path)
			: 'm:' + pathToString(r.parent ? r.parent.path : []) + '@' + r.loaded;
	}

	const ROW_H = 24;
	const OVERSCAN = 6;
	let scroller: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	const win = $derived(fixedWindow(scrollTop, viewportHeight, rows.length, ROW_H, OVERSCAN));
	const startIndex = $derived(win.start);
	const endIndex = $derived(win.end);
	const visibleRows = $derived(rows.slice(startIndex, endIndex));
	const totalHeight = $derived(rows.length * ROW_H);

	function onScroll() {
		if (scroller) scrollTop = scroller.scrollTop;
	}

	$effect(() => {
		if (!scroller) return;
		viewportHeight = scroller.clientHeight;
		const ro = new ResizeObserver(() => {
			if (scroller) viewportHeight = scroller.clientHeight;
		});
		ro.observe(scroller);
		return () => ro.disconnect();
	});
</script>

<div class="panel">
	{#if !context}
		<div class="empty dim text-xs">No document in this tab</div>
	{:else if loading && roots.length === 0}
		<div class="empty dim text-xs">Loading…</div>
	{:else if error}
		<div class="empty err text-xs">{error}</div>
	{:else if roots.length === 0}
		<div class="empty dim text-xs">Empty document</div>
	{:else}
		<div class="section-label">
			<span>document</span>
			<span class="section-count">{roots.length}{rootsMore ? '+' : ''}</span>
		</div>
		<div class="scroller" bind:this={scroller} onscroll={onScroll}>
			<div class="spacer" style="height: {totalHeight}px;">
				{#each visibleRows as r, i (rowKey(r))}
					{@const idx = startIndex + i}
					{#if r.type === 'node'}
						{@const n = r.node}
						<button
							class="list-row row"
							style="top: {idx * ROW_H}px; height: {ROW_H}px; padding-left: {0.4 +
								n.depth * 0.7}rem;"
							onclick={() => toggle(n)}
							ondblclick={() => onNavigate?.(n.path)}
							title={pathToString(n.path)}
						>
							{#if expandable(n)}
								<span class="caret"
									><Icon icon={n.expanded ? ChevronDown : ChevronRight} size="xs" /></span
								>
							{:else}
								<span class="caret"> </span>
							{/if}
							<span class="glyph">{glyph(n)}</span>
							<span class="key" class:idx={typeof n.key === 'number'}>{label(n)}</span>
							{#if n.childCount !== null && expandable(n)}
								<span class="ct">{n.childCount}</span>
							{/if}
						</button>
					{:else}
						<button
							class="list-row row more"
							style="top: {idx * ROW_H}px; height: {ROW_H}px; padding-left: {0.4 +
								r.depth * 0.7}rem;"
							onclick={() => loadMore(r.parent, r.loaded)}
							title="Load the next {PER_LEVEL}"
						>
							<span class="caret"> </span>
							<span class="more-label">Load {PER_LEVEL} more…</span>
						</button>
					{/if}
				{/each}
			</div>
		</div>
		<div class="hint text-xs dim">click to expand · double-click to jump</div>
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

	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		position: relative;
	}
	.spacer {
		position: relative;
		width: 100%;
	}
	.row {
		position: absolute;
		left: 0;
		right: 0;
		contain: layout style paint;
	}

	.caret {
		width: 10px;
		color: var(--accent);
		flex-shrink: 0;
		text-align: center;
	}
	.glyph {
		color: var(--syntax-punct);
		width: 14px;
		flex-shrink: 0;
		font-size: 11px;
	}
	.key {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.key.idx {
		color: var(--text-faint);
	}
	.ct {
		color: var(--text-ghost);
		margin-left: auto;
		font-size: 10px;
		padding-left: 8px;
	}

	.more-label {
		color: var(--text-faint);
		font-style: italic;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.row.more:hover .more-label {
		color: var(--accent);
	}

	.hint {
		flex-shrink: 0;
		padding: 0.4rem 0.5rem;
		border-top: var(--rule-width) solid var(--rule);
	}
</style>
