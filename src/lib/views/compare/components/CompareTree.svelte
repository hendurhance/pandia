<script lang="ts">
	import { docGetSlice, docSummary } from '$lib/ipc/doc';
	import type { DiffKind, DocHandle, Path } from '$lib/ipc/types';
	import {
		expandGapWindow,
		insertChildrenWithClose,
		isExpandable,
		pathKey,
		removeSubtree,
		replacePlaceholders,
		rootRow,
		viewToRow,
		type ContentRow,
		type Row,
		type VirtualGapRow,
	} from '$lib/views/tree/logic/model';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';

	interface Props {
		handle: DocHandle;

		diff: Map<string, DiffKind>;

		diffPaths: Path[];

		activePath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;
	}
	let { handle, diff, diffPaths, activePath = null, onScrollerReady }: Props = $props();

	let scrollRequest = $state<{ idx: number; nonce: number } | null>(null);
	let scrollNonce = 0;
	$effect(() => {
		const target = activePath;
		if (!target) {
			scrollRequest = null;
			return;
		}
		void (async () => {
			await ensurePathVisible(target);
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
			const idx = contentRowIdx(target);
			if (idx >= 0) {
				scrollNonce++;
				scrollRequest = { idx, nonce: scrollNonce };
			}
		})();
	});

	const CHUNK = 200;
	let rows: Row[] = $state.raw([]);
	const inFlight = new Map<string, Promise<void>>();

	const pathIndex = new Map<string, number>();
	let indexDirty = true;
	function rebuildIndex() {
		pathIndex.clear();
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r.variant === 'content') pathIndex.set(pathKey(r.path), i);
		}
	}
	function contentRowIdx(path: Path): number {
		if (indexDirty) {
			rebuildIndex();
			indexDirty = false;
		}
		return pathIndex.get(pathKey(path)) ?? -1;
	}

	let pendingFlush = false;
	function scheduleFlush() {
		indexDirty = true;
		if (pendingFlush) return;
		pendingFlush = true;
		requestAnimationFrame(() => {
			pendingFlush = false;
			rows = rows.slice();
		});
	}

	function materializeRange(parentPath: Path, fromIdx: number, toIdx: number): boolean {
		const parentK = pathKey(parentPath);
		let changed = false;
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r.variant !== 'vgap') continue;
			if (pathKey(r.parentPath) !== parentK) continue;
			if (r.toIndex <= fromIdx || r.fromIndex >= toIdx) continue;
			const inserted = expandGapWindow(rows, i, fromIdx, toIdx);
			if (inserted > 0) {
				changed = true;
				i += inserted;
			}
		}
		if (changed) scheduleFlush();
		return changed;
	}

	function materializeGap(gap: VirtualGapRow, fromIdx: number, toIdx: number) {
		let i = rows.indexOf(gap);
		if (i < 0) {
			const parentK = pathKey(gap.parentPath);
			i = rows.findIndex(
				(r) =>
					r.variant === 'vgap' &&
					pathKey(r.parentPath) === parentK &&
					r.fromIndex <= fromIdx &&
					r.toIndex > fromIdx,
			);
		}
		if (i < 0) return;
		const inserted = expandGapWindow(rows, i, fromIdx, toIdx);
		if (inserted > 0) scheduleFlush();
	}

	async function fetchInitialChunk(path: Path, depth: number): Promise<ContentRow[]> {
		const views = await docGetSlice(handle, path, 0, CHUNK);
		return views.map((v) => viewToRow(v, path, depth));
	}

	const inFlightExpand = new Map<string, Promise<void>>();

	async function toggleAt(index: number) {
		const row = rows[index];
		if (row?.variant !== 'content' || !isExpandable(row)) return;
		if (row.expanded) {
			removeSubtree(rows, index);
			rows[index] = { ...row, expanded: false };
			scheduleFlush();
			return;
		}
		const key = pathKey(row.path);
		const existing = inFlightExpand.get(key);
		if (existing) {
			try {
				await existing;
			} catch {}
			return;
		}
		const expansion = (async () => {
			const children = await fetchInitialChunk(row.path, row.depth);
			// Re-check after the await — another row mutation could have shifted
			const cur = rows[index];
			if (cur?.variant !== 'content' || cur.expanded) return;
			insertChildrenWithClose(rows, index, children, row.childCount);
			rows[index] = { ...row, expanded: true };
			scheduleFlush();
		})();
		inFlightExpand.set(key, expansion);
		try {
			await expansion;
		} catch {
		} finally {
			inFlightExpand.delete(key);
		}
	}

	function chunkKey(parentPath: Path, chunkStart: number): string {
		return pathKey(parentPath) + '@' + chunkStart;
	}

	async function fetchChunk(parentPath: Path, parentDepth: number, chunkStart: number) {
		const key = chunkKey(parentPath, chunkStart);
		const existing = inFlight.get(key);
		if (existing) {
			try {
				await existing;
			} catch {}
			return;
		}
		const work = (async () => {
			materializeRange(parentPath, chunkStart, chunkStart + CHUNK);
			const views = await docGetSlice(handle, parentPath, chunkStart, chunkStart + CHUNK);
			const newRows = views.map((v) => viewToRow(v, parentPath, parentDepth));
			replacePlaceholders(rows, parentPath, chunkStart, newRows);
			scheduleFlush();
		})();
		inFlight.set(key, work);
		try {
			await work;
		} catch {
		} finally {
			inFlight.delete(key);
		}
	}

	let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingRange: { start: number; end: number } | null = null;
	function onVisibleRange(start: number, end: number) {
		pendingRange = { start, end };
		if (fetchDebounceTimer != null) clearTimeout(fetchDebounceTimer);
		fetchDebounceTimer = setTimeout(() => {
			fetchDebounceTimer = null;
			const range = pendingRange;
			pendingRange = null;
			if (!range) return;
			fetchInRange(range.start, range.end);
		}, 80);
	}
	function fetchInRange(start: number, end: number) {
		const seen = new Set<string>();
		for (let i = start; i < end && i < rows.length; i++) {
			const r = rows[i];
			if (r.variant !== 'placeholder') continue;
			const chunkStart = Math.floor(r.index / CHUNK) * CHUNK;
			const key = chunkKey(r.parentPath, chunkStart);
			if (seen.has(key)) continue;
			seen.add(key);
			fetchChunk(r.parentPath, r.depth - 1, chunkStart);
		}
	}

	function siblingCount(parentPath: Path): number | null {
		if (parentPath.length === 0) return null;
		const idx = contentRowIdx(parentPath);
		const r = idx >= 0 ? rows[idx] : null;
		return r && r.variant === 'content' ? r.childCount : null;
	}

	async function ensureChunkLoaded(prefix: Path) {
		const parentPath = prefix.slice(0, -1);
		const pIdx = contentRowIdx(parentPath);
		if (pIdx < 0) return;
		const parentRow = rows[pIdx];
		if (parentRow.variant !== 'content') return;
		const parentDepth = parentRow.depth;
		const lastSeg = prefix[prefix.length - 1];
		if (typeof lastSeg === 'number') {
			const chunkStart = Math.floor(lastSeg / CHUNK) * CHUNK;
			await fetchChunk(parentPath, parentDepth, chunkStart);
			return;
		}
		const count = siblingCount(parentPath);
		for (let cs = 0; count == null || cs < count; cs += CHUNK) {
			await fetchChunk(parentPath, parentDepth, cs);
			if (contentRowIdx(prefix) >= 0) return;
			if (cs > 500_000) return; // safety
		}
	}

	async function ensurePathVisible(target: Path) {
		for (let depth = 0; depth <= target.length; depth++) {
			const prefix = target.slice(0, depth);
			let idx = contentRowIdx(prefix);
			if (idx < 0 && depth > 0) {
				await ensureChunkLoaded(prefix);
				idx = contentRowIdx(prefix);
			}
			if (idx < 0) return;
			if (depth < target.length) {
				const row = rows[idx];
				if (row.variant === 'content' && !row.expanded && isExpandable(row)) {
					await toggleAt(idx);
				}
			}
		}
	}

	$effect(() => {
		const h = handle;
		const paths = diffPaths;
		let cancelled = false;
		void (async () => {
			let sum;
			try {
				sum = await docSummary(h);
			} catch {
				return;
			}
			if (cancelled) return;
			const root = rootRow(sum.rootKind, sum.rootChildCount);
			rows = [root];
			if (isExpandable(root)) await toggleAt(0);
			void paths;
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<TreeView
	{rows}
	selectedIndex={-1}
	onToggle={toggleAt}
	onSelect={() => {}}
	{onVisibleRange}
	onMaterializeGap={materializeGap}
	onRowMenu={() => {}}
	{scrollRequest}
	editing={null}
	onEditInput={() => {}}
	onEditCommit={() => {}}
	onEditCancel={() => {}}
	readOnly
	diffHighlights={diff}
	{onScrollerReady}
/>
