import { ipc } from '$lib/ipc/client';
import type { DocHandle, GridFilter, Path, RowJson } from '$lib/ipc/bindings';
import { decodeLossless } from '$lib/ipc/wire';
import { IpcError } from '$lib/ipc/error';
import { describeError } from '$lib/ipc/error-copy';
import { PagedSource } from '$lib/views/shared/paged-source.svelte';
import { WindowedScroller } from '$lib/views/shared/windowed-scroller.svelte';
import { UNLOADED, MISSING, cellText } from '../logic/grid-cell';

export const ROW_HEIGHT = 24;
const ROW_OVERSCAN = 8;
const CHUNK = 100;

export interface GridRow {
	index: number;
	value: unknown;
}

export interface GridQuery {
	sortKey: string | null;
	sortDesc: boolean;

	filterGroups: GridFilter[][];

	quick: string;
	quickKeys: string[];
	filtering: boolean;
}

export interface GridDataDeps {
	handle: () => DocHandle;
	path: () => Path;
	rowCount: () => number;
	query: () => GridQuery;

	onFilterOverflow: (message: string) => void;

	onError: (message: string) => void;
}

export class GridDataController {
	private filterJobId: string | null = null;

	private readonly source = new PagedSource<GridRow>({
		pageSize: CHUNK,
		debounceMs: 0,
		fetch: async (start, end) => {
			const q = this.deps.query();
			const handle = this.deps.handle();
			const path = this.deps.path();
			const decodeRow = (r: RowJson): GridRow => ({
				index: r.index,
				value: decodeLossless(r.value),
			});
			if (q.filtering) {
				if (!this.filterJobId) {
					this.filterJobId = `grid-filter-${start}-${Math.random().toString(36).slice(2, 10)}`;
				}
				const res = await ipc.docGetRowsFiltered(
					handle,
					path,
					start,
					end,
					{
						groups: q.filterGroups,
						quick: q.quick.trim() || null,
						quickKeys: q.quickKeys,
						sortKey: q.sortKey,
						descending: q.sortDesc,
					},
					this.filterJobId,
				);
				return { items: res.rows.map(decodeRow), total: res.total };
			}
			if (q.sortKey) {
				const hi = Math.min(end, this.deps.rowCount());
				const rows = await ipc.docGetRowsSorted(handle, path, start, hi, q.sortKey, q.sortDesc);
				return { items: rows.map(decodeRow) };
			}
			const hi = Math.min(end, this.deps.rowCount());
			const raw = await ipc.docGetRows(handle, path, start, hi);
			return { items: raw.map((value, k) => ({ index: start + k, value: decodeLossless(value) })) };
		},
		onError: (e) => {
			if (e instanceof IpcError && e.kind === 'cancelled') return;
			if (this.deps.query().sortKey || this.deps.query().filtering) {
				this.deps.onFilterOverflow(describeError(e));
			} else {
				this.deps.onError(describeError(e));
			}
		},
		onReset: () => {
			if (this.filterJobId) {
				void ipc.cancelJob(this.filterJobId);
				this.filterJobId = null;
			}
		},
	});

	readonly scroller = new WindowedScroller({
		rowCount: () => this.effectiveRowCount,
		rowHeight: ROW_HEIGHT,
		overscan: ROW_OVERSCAN,
	});

	constructor(private deps: GridDataDeps) {}

	get chunks(): Map<number, GridRow[]> {
		return this.source.pages;
	}

	get filteredTotal(): number | null {
		return this.source.total;
	}

	get fetching(): boolean {
		return this.source.fetching;
	}

	readonly effectiveRowCount = $derived.by(() =>
		this.deps.query().filtering ? (this.filteredTotal ?? 0) : this.deps.rowCount(),
	);

	readonly visibleRows = $derived(
		Array.from(
			{ length: Math.max(0, this.scroller.window.end - this.scroller.window.start) },
			(_, k) => this.scroller.window.start + k,
		),
	);

	chunkStart = (i: number): number => this.source.pageStart(i);

	getRow = (rowIdx: number): GridRow | undefined => this.source.get(rowIdx);

	getCell = (rowIdx: number, colKey: string): unknown => {
		const row = this.getRow(rowIdx);
		if (!row) return UNLOADED;
		const v = row.value;
		if (v === null || typeof v !== 'object') return MISSING;
		return (v as Record<string, unknown>)[colKey] ?? MISSING;
	};

	loadedColumnTexts = (colKey: string): string[] => {
		const out: string[] = [];
		for (const rows of this.chunks.values()) {
			for (const row of rows) {
				const v = row.value;
				if (v === null || typeof v !== 'object') continue;
				const cell = (v as Record<string, unknown>)[colKey];
				if (cell === undefined) continue;
				out.push(cellText(cell));
			}
		}
		return out;
	};

	fetchVisible = () => {
		const range = this.scroller.window;
		this.source.ensureVisible(range.start, range.end);
	};

	fetchRange = async (lo: number, hi: number) => {
		await this.source.ensureRange(lo, hi + 1);
	};

	reset = () => {
		this.source.reset();
	};
}
