import { ipc } from '$lib/ipc/client';
import { describeError } from '$lib/ipc/error-copy';
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
import { collectExpandedDescendants, remapAfterOp } from '../logic/tree-walk';
import { findIndexPaged, placeholderChunks } from '../logic/paging';
import { PathIndex } from '../logic/row-cache';
import { InFlight } from '$lib/views/shared/in-flight';
import { decodeLossless, type LosslessText } from '$lib/ipc/wire';
import type { DocHandle, NodeKind, Op, Path, Summary } from '$lib/ipc/bindings';

const CHUNK = 200;
const PREVIEW_MAX_CHARS = 1000;

export interface TreeRowsDeps {
	handle: () => DocHandle | null;
	summary: () => Summary | null;
	setError: (msg: string) => void;
}

function scalarPreview(kind: NodeKind, text: LosslessText): string {
	if (kind !== 'string') return text;
	const s = decodeLossless(text) as string;
	let chars = 0;
	let end = 0;
	for (const ch of s) {
		if (chars++ === PREVIEW_MAX_CHARS) return `"${s.slice(0, end)}…"`;
		end += ch.length;
	}
	return `"${s}"`;
}

export async function fetchRootRow(
	handle: DocHandle,
	summary: Pick<Summary, 'rootKind' | 'rootChildCount'>,
): Promise<ContentRow> {
	const root = rootRow(summary.rootKind, summary.rootChildCount);
	if (root.kind === 'object' || root.kind === 'array') return root;
	return { ...root, preview: scalarPreview(root.kind, await ipc.docGetValue(handle, [])) };
}

export class TreeRowsController {
	rows: Row[] = $state.raw([]);

	private readonly inFlight = new InFlight<string>();
	private readonly pathIndex = new PathIndex();

	private pendingFlush = false;
	private scheduleFlush() {
		this.pathIndex.invalidate();
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
		this.pathIndex.invalidate();
	};

	clearChunks = () => {
		this.inFlight.clear();
	};

	contentRowIdx = (path: Path): number => this.pathIndex.find(this.rows, path);

	siblingCount = (parentPath: Path): number | null => {
		if (parentPath.length === 0) return this.deps.summary()?.rootChildCount ?? null;
		const idx = this.contentRowIdx(parentPath);
		const r = idx >= 0 ? this.rows[idx] : null;
		return r && r.variant === 'content' ? r.childCount : null;
	};

	private async fetchInitialChunk(path: Path, depth: number): Promise<ContentRow[]> {
		const handle = this.deps.handle();
		if (!handle) return [];
		const views = await ipc.docGetSlice(handle, path, 0, CHUNK);
		return views.map((v) => viewToRow(v, path, depth));
	}

	private readonly expanding = new InFlight<string>();

	toggleAt = async (index: number) => {
		if (!this.deps.handle()) return;
		const row = this.rows[index];
		if (row?.variant !== 'content' || !isExpandable(row)) return;

		if (row.expanded) {
			removeSubtree(this.rows, index);
			this.rows[index] = { ...row, expanded: false };
			this.scheduleFlush();
			return;
		}

		const key = pathKey(row.path);
		if (this.expanding.get(key)) return;
		await this.expanding.run(key, () => this.expand(row));
	};

	private async expand(row: ContentRow) {
		try {
			const children = await this.fetchInitialChunk(row.path, row.depth);
			let at = this.contentRowIdx(row.path);
			let cur = this.rows[at];
			if (cur?.variant !== 'content' || cur.expanded) return;
			let total = cur.childCount;
			if (total === null && children.length < CHUNK) total = children.length;
			if (total === null) {
				const handle = this.deps.handle();
				if (handle) {
					try {
						total = await ipc.docChildCount(handle, cur.path);
					} catch {
						total = null;
					}
					at = this.contentRowIdx(row.path);
					cur = this.rows[at];
					if (cur?.variant !== 'content' || cur.expanded) return;
				}
			}
			insertChildrenWithClose(this.rows, at, children, total);
			this.rows[at] = { ...cur, expanded: true, childCount: total };
			this.scheduleFlush();
		} catch (e) {
			this.deps.setError(describeError(e));
		}
	}

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
			} catch {}
			return;
		}
		try {
			await this.inFlight.run(key, async () => {
				this.materializeRange(parentPath, chunkStart, chunkStart + CHUNK);
				const views = await ipc.docGetSlice(handle, parentPath, chunkStart, chunkStart + CHUNK);
				const newRows = views.map((v) => viewToRow(v, parentPath, parentDepth));
				replacePlaceholders(this.rows, parentPath, chunkStart, newRows);
				this.scheduleFlush();
			});
		} catch (e) {
			this.deps.setError(describeError(e));
		}
	}

	private materializeRange(parentPath: Path, fromIdx: number, toIdx: number): boolean {
		const parentKey = pathKey(parentPath);
		let changed = false;
		for (let i = 0; i < this.rows.length; i++) {
			const r = this.rows[i];
			if (!r || r.variant !== 'vgap') continue;
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
		for (const c of placeholderChunks(this.rows, start, end, CHUNK)) {
			void this.fetchChunk(c.parentPath, c.parentDepth, c.chunkStart);
		}
	}

	private async ensureChunkLoaded(prefix: Path) {
		const parentPath = prefix.slice(0, -1);
		const pIdx = this.contentRowIdx(parentPath);
		if (pIdx < 0) return;
		const parentRow = this.rows[pIdx];
		if (!parentRow || parentRow.variant !== 'content') return;
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
				if (row?.variant === 'content' && !row.expanded && isExpandable(row)) {
					await this.toggleAt(idx);
				}
			}
		}
	};

	private lastRefetch: Promise<void> = Promise.resolve();

	refetchAfterOp = (affectedPaths: Path[], op?: Op): Promise<void> => {
		const run = this.lastRefetch.then(async () => {
			for (const path of affectedPaths) {
				await this.refreshPath(path, op);
			}
		});
		this.lastRefetch = run.catch(() => {});
		return run;
	};

	private async refreshPath(path: Path, op: Op | undefined) {
		if (!this.deps.handle()) return;
		const idx = this.contentRowIdx(path);
		if (idx < 0) return; // not visible — fresh data lands when user expands

		const row = this.rows[idx];
		if (!row || row.variant !== 'content') return;

		const refreshed = await this.fetchUpdatedRow(row);
		if (refreshed === null) return;
		const at = this.contentRowIdx(path);
		const cur = this.rows[at];
		if (cur?.variant !== 'content') return;

		const isCollection = refreshed.kind === 'object' || refreshed.kind === 'array';

		if (cur.expanded) {
			const reopen = remapAfterOp(collectExpandedDescendants(this.rows, at, cur.depth), path, op);
			removeSubtree(this.rows, at);
			this.rows[at] = { ...refreshed, expanded: false };
			this.scheduleFlush();
			if (isCollection) {
				await this.toggleAt(at);
				if (reopen.length > 0) await this.reExpand(reopen);
			}
			return;
		}

		this.rows[at] = { ...refreshed, expanded: cur.expanded };
		this.scheduleFlush();
	}

	private async reExpand(paths: Path[]) {
		for (const path of paths) {
			await this.ensurePathVisible(path);
			const idx = this.contentRowIdx(path);
			if (idx < 0) continue;
			const r = this.rows[idx];
			if (r?.variant === 'content' && isExpandable(r) && !r.expanded) {
				await this.toggleAt(idx);
			}
		}
	}

	private async fetchUpdatedRow(row: ContentRow): Promise<ContentRow | null> {
		const handle = this.deps.handle();
		if (!handle) return null;
		try {
			if (row.path.length === 0) return await fetchRootRow(handle, await ipc.docSummary(handle));
			const parentPath = row.path.slice(0, -1);
			const lastSeg = row.path[row.path.length - 1];
			const slice = (start: number, end: number) => ipc.docGetSlice(handle, parentPath, start, end);
			const pos =
				typeof lastSeg === 'number'
					? lastSeg
					: await findIndexPaged(slice, (nv) => nv.key === lastSeg, CHUNK, Infinity);
			if (pos === null) return null;
			const [newView] = await slice(pos, pos + 1);
			if (!newView) return null;
			return viewToRow(newView, parentPath, row.depth - 1);
		} catch (e) {
			this.deps.setError(describeError(e));
			return null;
		}
	}
}
