import { docGetSlice, docSummary } from '$lib/ipc/doc';
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
} from '../logic/model';
import { collectExpandedDescendants } from '../logic/tree-walk';
import type { DocHandle, OpenResult, Path } from '$lib/ipc/types';

const CHUNK = 200;

export interface TreeRowsDeps {
	handle: () => DocHandle | null;
	summary: () => OpenResult['summary'] | null;
	setError: (msg: string) => void;
}

export class TreeRowsController {
	rows: Row[] = $state.raw([]);

	private inFlight = new Map<string, Promise<void>>();

	private pathIndex = new Map<string, number>();
	private indexDirty = true;
	private rebuildIndex() {
		this.pathIndex.clear();
		for (let i = 0; i < this.rows.length; i++) {
			const r = this.rows[i];
			if (r.variant === 'content') this.pathIndex.set(pathKey(r.path), i);
		}
	}

	private pendingFlush = false;
	private scheduleFlush() {
		this.indexDirty = true;
		if (this.pendingFlush) return;
		this.pendingFlush = true;
		requestAnimationFrame(() => {
			this.pendingFlush = false;
			this.rows = this.rows.slice();
		});
	}

	constructor(private deps: TreeRowsDeps) {}

	
	setRows = (rows: Row[]) => {
		this.rows = rows;
		this.inFlight.clear();
		this.indexDirty = true;
	};

	
	clearChunks = () => {
		this.inFlight.clear();
	};

	
	contentRowIdx = (path: Path): number => {
		if (this.indexDirty) {
			this.rebuildIndex();
			this.indexDirty = false;
		}
		return this.pathIndex.get(pathKey(path)) ?? -1;
	};

	
	siblingCount = (parentPath: Path): number | null => {
		if (parentPath.length === 0) return this.deps.summary()?.rootChildCount ?? null;
		const idx = this.contentRowIdx(parentPath);
		const r = idx >= 0 ? this.rows[idx] : null;
		return r && r.variant === 'content' ? r.childCount : null;
	};

	private async fetchInitialChunk(path: Path, depth: number): Promise<ContentRow[]> {
		const handle = this.deps.handle();
		if (!handle) return [];
		const views = await docGetSlice(handle, path, 0, CHUNK);
		return views.map((v) => viewToRow(v, path, depth));
	}

	
	toggleAt = async (index: number) => {
		if (!this.deps.handle()) return;
		const row = this.rows[index];
		if (row.variant !== 'content' || !isExpandable(row)) return;

		if (row.expanded) {
			removeSubtree(this.rows, index);
			this.rows[index] = { ...row, expanded: false };
			this.scheduleFlush();
			return;
		}

		try {
			const children = await this.fetchInitialChunk(row.path, row.depth);
			insertChildrenWithClose(this.rows, index, children, row.childCount);
			this.rows[index] = { ...row, expanded: true };
			this.scheduleFlush();
		} catch (e) {
			this.deps.setError(String(e));
		}
	};

	private chunkKey(parentPath: Path, chunkStart: number): string {
		return pathKey(parentPath) + '@' + chunkStart;
	}

	private async fetchChunk(parentPath: Path, parentDepth: number, chunkStart: number) {
		const handle = this.deps.handle();
		if (!handle) return;
		const key = this.chunkKey(parentPath, chunkStart);
		const existing = this.inFlight.get(key);
		if (existing) {
			try {
				await existing;
			} catch {
				
			}
			return;
		}
		const work = (async () => {
			this.materializeRange(parentPath, chunkStart, chunkStart + CHUNK);
			const views = await docGetSlice(handle, parentPath, chunkStart, chunkStart + CHUNK);
			const newRows = views.map((v) => viewToRow(v, parentPath, parentDepth));
			replacePlaceholders(this.rows, parentPath, chunkStart, newRows);
			this.scheduleFlush();
		})();
		this.inFlight.set(key, work);
		try {
			await work;
		} catch (e) {
			this.deps.setError(String(e));
		} finally {
			this.inFlight.delete(key);
		}
	}

	
	private materializeRange(parentPath: Path, fromIdx: number, toIdx: number): boolean {
		const parentKey = pathKey(parentPath);
		let changed = false;
		for (let i = 0; i < this.rows.length; i++) {
			const r = this.rows[i];
			if (r.variant !== 'vgap') continue;
			if (pathKey(r.parentPath) !== parentKey) continue;
			if (r.toIndex <= fromIdx || r.fromIndex >= toIdx) continue;
			const inserted = expandGapWindow(this.rows, i, fromIdx, toIdx);
			if (inserted > 0) {
				changed = true;
				i += inserted; // close enough; another vgap continues the scan
			}
		}
		if (changed) this.scheduleFlush();
		return changed;
	}

	
	materializeGap = (gap: VirtualGapRow, fromIdx: number, toIdx: number) => {
		let i = this.rows.indexOf(gap);
		if (i < 0) {
			const parentKey = pathKey(gap.parentPath);
			i = this.rows.findIndex(
				(r) =>
					r.variant === 'vgap' &&
					pathKey(r.parentPath) === parentKey &&
					r.fromIndex <= fromIdx &&
					r.toIndex > fromIdx,
			);
		}
		if (i < 0) return;
		const inserted = expandGapWindow(this.rows, i, fromIdx, toIdx);
		if (inserted > 0) this.scheduleFlush();
	};

	private fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingRange: { start: number; end: number } | null = null;

	
	onVisibleRange = (start: number, end: number) => {
		this.pendingRange = { start, end };
		if (this.fetchDebounceTimer != null) clearTimeout(this.fetchDebounceTimer);
		this.fetchDebounceTimer = setTimeout(() => {
			this.fetchDebounceTimer = null;
			const range = this.pendingRange;
			this.pendingRange = null;
			if (!range) return;
			this.fetchInRange(range.start, range.end);
		}, 80);
	};

	private fetchInRange(start: number, end: number) {
		const seen = new Set<string>();
		for (let i = start; i < end && i < this.rows.length; i++) {
			const r = this.rows[i];
			if (r.variant !== 'placeholder') continue;
			const chunkStart = Math.floor(r.index / CHUNK) * CHUNK;
			const key = this.chunkKey(r.parentPath, chunkStart);
			if (seen.has(key)) continue;
			seen.add(key);
			void this.fetchChunk(r.parentPath, r.depth - 1, chunkStart);
		}
	}

	
	private async ensureChunkLoaded(prefix: Path) {
		const parentPath = prefix.slice(0, -1);
		const pIdx = this.contentRowIdx(parentPath);
		if (pIdx < 0) return;
		const parentRow = this.rows[pIdx];
		if (parentRow.variant !== 'content') return;
		const parentDepth = parentRow.depth;
		const lastSeg = prefix[prefix.length - 1];

		if (typeof lastSeg === 'number') {
			const chunkStart = Math.floor(lastSeg / CHUNK) * CHUNK;
			await this.fetchChunk(parentPath, parentDepth, chunkStart);
			return;
		}
		const count = this.siblingCount(parentPath);
		for (let cs = 0; count == null || cs < count; cs += CHUNK) {
			await this.fetchChunk(parentPath, parentDepth, cs);
			if (this.contentRowIdx(prefix) >= 0) return;
			if (cs > 500_000) return; // safety: don't page forever
		}
	}

	
	ensurePathVisible = async (target: Path) => {
		for (let depth = 0; depth <= target.length; depth++) {
			const prefix = target.slice(0, depth);
			let idx = this.contentRowIdx(prefix);
			if (idx < 0 && depth > 0) {
				await this.ensureChunkLoaded(prefix);
				idx = this.contentRowIdx(prefix);
			}
			if (idx < 0) return; // couldn't locate this level — give up
			if (depth < target.length) {
				const row = this.rows[idx];
				if (row.variant === 'content' && !row.expanded && isExpandable(row)) {
					await this.toggleAt(idx);
				}
			}
		}
	};

	
	refetchAfterOp = async (affectedPaths: Path[]) => {
		for (const path of affectedPaths) {
			await this.refreshPath(path);
		}
	};

	private async refreshPath(path: Path) {
		if (!this.deps.handle()) return;
		const idx = this.contentRowIdx(path);
		if (idx < 0) return; // not visible — fresh data lands when user expands

		const row = this.rows[idx];
		if (row.variant !== 'content') return;

		const refreshed = await this.fetchUpdatedRow(row);
		if (refreshed === null) return;

		const isCollection = refreshed.kind === 'object' || refreshed.kind === 'array';

		if (row.expanded && isCollection) {
			const reopen = collectExpandedDescendants(this.rows, idx, row.depth);
			removeSubtree(this.rows, idx);
			this.rows[idx] = { ...refreshed, expanded: false };
			this.scheduleFlush();
			await this.toggleAt(idx);
			if (reopen.length > 0) await this.reExpand(reopen);
			return;
		}

		this.rows[idx] = { ...refreshed, expanded: row.expanded };
		this.scheduleFlush();
	}

	
	private async reExpand(paths: Path[]) {
		for (const path of paths) {
			await this.ensurePathVisible(path);
			const idx = this.contentRowIdx(path);
			if (idx < 0) continue;
			const r = this.rows[idx];
			if (r.variant === 'content' && isExpandable(r) && !r.expanded) {
				await this.toggleAt(idx);
			}
		}
	}

	
	private async fetchUpdatedRow(row: ContentRow): Promise<ContentRow | null> {
		const handle = this.deps.handle();
		if (!handle) return null;
		try {
			if (row.path.length === 0) {
				const sum = await docSummary(handle);
				return rootRow(sum.rootKind, sum.rootChildCount);
			}
			const parentPath = row.path.slice(0, -1);
			const lastSeg = row.path[row.path.length - 1];
			const parentSlice = await docGetSlice(handle, parentPath, 0, CHUNK);
			const newView = parentSlice.find(
				(nv) => typeof nv.key === typeof lastSeg && nv.key === lastSeg,
			);
			if (!newView) return null;
			return viewToRow(newView, parentPath, row.depth - 1);
		} catch (e) {
			this.deps.setError(String(e));
			return null;
		}
	}
}
