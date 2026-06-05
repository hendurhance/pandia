<script module lang="ts">
	export interface GraphViewApi {
		openSearch: () => void;
	}
</script>

<script lang="ts">
	import { save as saveDialog } from '@tauri-apps/plugin-dialog';
	import { writeFile } from '@tauri-apps/plugin-fs';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { onDestroy, untrack } from 'svelte';
	import type { DocHandle, NodeKind, Path } from '$lib/ipc/types';
	import { layoutGraph, isContainerKind, type CardRow, type GraphCard } from '../logic/layout';
	import { buildCard, collapseTree, expandRow as expandRowFetch } from '../logic/card-builder';
	import { searchCards } from '../logic/card-search';
	import { paintFullLayout, planRasterExport } from '../logic/render';
	import { exportLayoutSVG } from '../logic/render-svg';
	import { readGraphTheme } from '../logic/theme';
	import { stem } from '$lib/util/path';
	import GraphCanvas, { type GraphCanvasApi } from './GraphCanvas.svelte';
	import GraphDock from './GraphDock.svelte';
	import GraphExportMenu, { type ExportFormat } from './GraphExportMenu.svelte';
	import GraphSearchBar from './GraphSearchBar.svelte';
	import GraphSettings from './GraphSettings.svelte';

	interface Props {
		handle: DocHandle;
		rootKind: NodeKind;
		rootChildCount: number | null;
		sourcePath?: string | null;
		onPickPath: (path: Path) => void;

		onReady?: (api: GraphViewApi | null) => void;
	}

	let {
		handle,
		rootKind,
		rootChildCount,
		sourcePath = null,
		onPickPath,
		onReady,
	}: Props = $props();

	const CARD_BUDGET = 40;
	const AUTO_DEPTH = 4;

	let edgeStyle: 'elbow' | 'curve' = $state('elbow');
	let animateExpand = $state(true);
	let settingsOpen = $state(false);
	let settingsBtn: HTMLButtonElement | null = $state(null);

	let root: GraphCard | null = $state.raw(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	const layout = $derived(
		root ? layoutGraph(root) : { cards: [], edges: [], width: 0, height: 0 },
	);

	async function initExpand() {
		try {
			const r = await buildCard(handle, [], rootKind);
			root = r;
			if (isContainerKind(rootKind) && (rootChildCount ?? 0) > 0) {
				let cardCount = 1;
				let frontier: { row: CardRow; depth: number }[] = r.rows
					.filter((x) => x.expandable)
					.map((x) => ({ row: x, depth: 1 }));
				while (frontier.length > 0 && cardCount < CARD_BUDGET) {
					const next: { row: CardRow; depth: number }[] = [];
					for (const { row, depth } of frontier) {
						if (cardCount >= CARD_BUDGET || depth > AUTO_DEPTH) break;
						await expandRowFetch(handle, row);
						cardCount += row.children.length;
						if (depth < AUTO_DEPTH) {
							for (const ch of row.children) {
								for (const cr of ch.rows)
									if (cr.expandable) next.push({ row: cr, depth: depth + 1 });
							}
						}
					}
					frontier = next;
					root = { ...r }; // reveal each BFS layer as it resolves
					if (animateExpand && frontier.length > 0) {
						await new Promise<void>((resolve) =>
							requestAnimationFrame(() => resolve()),
						);
					}
				}
			}
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
			queueMicrotask(() => canvasApi?.fitView());
		}
	}

	let initHandle: DocHandle | null = null;
	$effect(() => {
		const h = handle;
		if (h === initHandle) return;
		initHandle = h;
		loading = true;
		error = null;
		root = null;
		queueMicrotask(() => void initExpand());
	});

	async function toggleRow(row: CardRow) {
		if (!row.expandable || !root) return;
		if (row.children.length > 0) row.children = [];
		else await expandRowFetch(handle, row);
		root = { ...root }; // new identity → re-layout
	}

	function collapseAll() {
		if (!root) return;
		collapseTree(root);
		root = { ...root };
		queueMicrotask(() => canvasApi?.fitView());
	}

	
	function centerFirstItem() {
		if (!root) return;
		const first = layout.cards.find((c) => c.path.length === 0);
		if (!first) return;
		canvasApi?.centerOn(first.x + first.w / 2, first.y + first.h / 2);
	}

	
	const EXPAND_ALL_MAX_CARDS = 500;
	
	const EXPAND_ALL_BATCH = 20;
	let expanding = $state(false);

	async function expandAll() {
		if (!root || expanding) return;
		expanding = true;
		try {
			const queue: CardRow[] = [];
			const seed = (card: GraphCard) => {
				for (const r of card.rows) {
					if (r.expandable && r.children.length === 0) queue.push(r);
					for (const ch of r.children) seed(ch);
				}
			};
			seed(root);
			let cardCount = layout.cards.length;
			while (queue.length > 0 && cardCount < EXPAND_ALL_MAX_CARDS) {
				const room = EXPAND_ALL_MAX_CARDS - cardCount;
				const batch = queue.splice(0, Math.min(EXPAND_ALL_BATCH, room));
				await Promise.all(batch.map((row) => expandRowFetch(handle, row)));
				for (const row of batch) {
					cardCount += row.children.length;
					for (const ch of row.children) {
						for (const r of ch.rows) {
							if (r.expandable && r.children.length === 0) queue.push(r);
						}
					}
				}
				root = { ...root };
			}
		} catch (e) {
			error = String(e);
		} finally {
			expanding = false;
			queueMicrotask(() => canvasApi?.fitView());
		}
	}

	let canvasApi: GraphCanvasApi | null = $state(null);
	let scale = $state(1);
	const zoomPct = $derived(Math.round(scale * 100));

	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchActive = $state(0);
	const searchMatches = $derived(searchOpen && searchQuery ? searchCards(layout, searchQuery) : []);
	const searchCounter = $derived.by(() => {
		if (!searchOpen || !searchQuery.trim()) return '';
		if (searchMatches.length === 0) return 'no matches';
		return `${searchActive + 1} / ${searchMatches.length}`;
	});
	const searchHighlightId = $derived(
		searchMatches.length > 0 ? (searchMatches[searchActive]?.id ?? null) : null,
	);

	$effect(() => {
		const match = searchMatches[searchActive];
		if (!match || !canvasApi) return;
		const api = canvasApi;
		const cx = match.x + match.w / 2;
		const cy = match.y + match.h / 2;
		untrack(() => api.centerOn(cx, cy));
	});

	function openSearch() {
		searchOpen = true;
		searchActive = 0;
	}
	function closeSearch() {
		searchOpen = false;
	}
	function onSearchQueryChange(q: string) {
		searchQuery = q;
		searchActive = 0;
	}
	function searchNext() {
		if (searchMatches.length === 0) return;
		searchActive = (searchActive + 1) % searchMatches.length;
	}
	function searchPrev() {
		if (searchMatches.length === 0) return;
		searchActive = (searchActive - 1 + searchMatches.length) % searchMatches.length;
	}

	const api: GraphViewApi = { openSearch };
	$effect(() => {
		onReady?.(api);
		return () => onReady?.(null);
	});

	let isFullscreen = $state(false);
	$effect(() => {
		void getCurrentWebviewWindow()
			.isFullscreen()
			.then((v) => (isFullscreen = v))
			.catch(() => {
				
			});
	});
	async function toggleFullscreen() {
		const win = getCurrentWebviewWindow();
		try {
			const next = !isFullscreen;
			await win.setFullscreen(next);
			isFullscreen = next;
		} catch (e) {
			error = String(e);
		}
	}

	let exporting = $state(false);
	let exportMenuOpen = $state(false);
	let exportBtn: HTMLButtonElement | null = $state(null);

	function defaultExportName(format: ExportFormat): string {
		const base = sourcePath ? stem(sourcePath) : 'graph';
		const safe = base.trim() || 'graph';
		const ext = format === 'jpeg' ? 'jpg' : format;
		return `${safe}.${ext}`;
	}

	async function exportAs(format: ExportFormat) {
		if (exporting || layout.cards.length === 0) return;
		exporting = true;
		try {
			const filterByFormat: Record<ExportFormat, { name: string; extensions: string[] }> = {
				png: { name: 'PNG', extensions: ['png'] },
				jpeg: { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
				svg: { name: 'SVG', extensions: ['svg'] },
			};
			const path = await saveDialog({
				defaultPath: defaultExportName(format),
				filters: [filterByFormat[format]],
			});
			if (typeof path !== 'string') return;
			const theme = readGraphTheme();
			let bytes: Uint8Array;
			if (format === 'svg') {
				const svg = exportLayoutSVG(layout, theme, edgeStyle);
				bytes = new TextEncoder().encode(svg);
			} else {
				const RASTER_MARGIN = 40;
				const off = paintFullLayout(layout, theme, 4, RASTER_MARGIN);
				const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
				const quality = format === 'jpeg' ? 0.92 : undefined;
				const blob: Blob | null = await new Promise((resolve) =>
					off.toBlob((b) => resolve(b), mime, quality),
				);
				if (!blob) throw new Error('encoding failed');
				bytes = new Uint8Array(await blob.arrayBuffer());
			}
			await writeFile(path, bytes);
		} catch (e) {
			error = String(e);
		} finally {
			exporting = false;
		}
	}
</script>

<div class="graph-root">
	{#if loading && !root}
		<div class="state dim">building graph…</div>
	{:else if error}
		<div class="state err">{error}</div>
	{:else if root}
		<GraphCanvas
			{layout}
			onPickCard={onPickPath}
			onPortToggle={(row) => void toggleRow(row)}
			onScaleChange={(s) => (scale = s)}
			onReady={(api) => (canvasApi = api)}
			highlightCardId={searchHighlightId}
			{edgeStyle}
		/>
		<GraphSearchBar
			open={searchOpen}
			query={searchQuery}
			counter={searchCounter}
			navDisabled={searchMatches.length === 0}
			isError={searchOpen && !!searchQuery.trim() && searchMatches.length === 0}
			onQueryChange={onSearchQueryChange}
			onPrev={searchPrev}
			onNext={searchNext}
			onClose={closeSearch}
		/>
		<GraphDock
			{zoomPct}
			onCenterFirst={centerFirstItem}
			onFitView={() => canvasApi?.fitView()}
			onExpandAll={() => void expandAll()}
			onCollapseAll={collapseAll}
			onZoomOut={() => canvasApi?.zoomBy(0.8)}
			onZoomIn={() => canvasApi?.zoomBy(1.25)}
			onExport={() => (exportMenuOpen = !exportMenuOpen)}
			onToggleFullscreen={() => void toggleFullscreen()}
			{isFullscreen}
			onToggleSettings={() => (settingsOpen = !settingsOpen)}
			{settingsOpen}
			bind:settingsBtn
			bind:exportBtn
			{exportMenuOpen}
			expandDisabled={expanding}
			exportDisabled={exporting || layout.cards.length === 0}
		/>
		<GraphExportMenu
			open={exportMenuOpen}
			anchor={exportBtn}
			rasterDownscaled={planRasterExport(layout, 40).downscaled}
			onClose={() => (exportMenuOpen = false)}
			onPick={(f) => void exportAs(f)}
		/>
		<GraphSettings
			open={settingsOpen}
			{edgeStyle}
			{animateExpand}
			onEdgeStyle={(s) => (edgeStyle = s)}
			onAnimateExpand={(v) => (animateExpand = v)}
			onClose={() => (settingsOpen = false)}
			anchor={settingsBtn}
		/>
	{/if}
</div>

<style>
	.graph-root {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		font-family: var(--font-mono);
		color: var(--text);
	}
	.state {
		position: absolute;
		top: 1rem;
		left: 1rem;
		font-size: var(--font-size-sm);
		z-index: 1;
	}
	.err {
		color: var(--accent);
	}
</style>
