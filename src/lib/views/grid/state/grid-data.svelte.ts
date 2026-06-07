import {
	cancelJob,
	docGetRows,
	docGetRowsSorted,
	docGetRowsFiltered,
	type GridFilter,
	type SortedRow,
} from '$lib/ipc/doc';
import type { DocHandle, Path } from '$lib/ipc/types';
import { rowWindow } from '../logic/grid-geometry';
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
}

export class GridDataController {
	chunks = $state.raw(new Map<number, GridRow[]>());
	filteredTotal: number | null = $state(null);

	scrollTop = $state(0);
	scrollLeft = $state(0);
	viewportWidth = $state(0);
	viewportHeight = $state(0);

	private inFlight = new Map<number, Promise<void>>();
	private filterJobId: string | null = null;
	private generation = 0;
	fetching = $state(false);

	constructor(private deps: GridDataDeps) {}

	readonly effectiveRowCount = $derived.by(() =>
		this.deps.query().filtering ? (this.filteredTotal ?? 0) : this.deps.rowCount(),
	);

	private readonly rowRange = $derived(
		rowWindow(
			this.scrollTop,
			this.viewportHeight,
			ROW_HEIGHT,
			this.effectiveRowCount,
			ROW_OVERSCAN,
		),
	);

	readonly visibleRows = $derived(
		Array.from(
			{ length: Math.max(0, this.rowRange.end - this.rowRange.start) },
			(_, k) => this.rowRange.start + k,
		),
	);

	chunkStart = (i: number): number => Math.floor(i / CHUNK) * CHUNK;

	getRow = (rowIdx: number): GridRow | undefined => {
		const start = this.chunkStart(rowIdx);
		return this.chunks.get(start)?.[rowIdx - start];
	};

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

	private fetchChunk(start: number): Promise<void> {
		if (this.chunks.has(start)) return Promise.resolve();
		const existing = this.inFlight.get(start);
		if (existing) return existing;

		const q = this.deps.query();
		const handle = this.deps.handle();
		const path = this.deps.path();
		if (q.filtering && !this.filterJobId) {
			this.filterJobId = `grid-filter-${start}-${Math.random().toString(36).slice(2, 10)}`;
		}
		const jobId = q.filtering ? this.filterJobId : null;
		const gen = this.generation;
		const work = (async () => {
			try {
				let rows: GridRow[];
				let total: number | null = null;
				if (q.filtering) {
					const res = await docGetRowsFiltered(
						handle,
						path,
						start,
						start + CHUNK,
						q.filterGroups,
						q.quick.trim() || null,
						q.quickKeys,
						q.sortKey,
						q.sortDesc,
						jobId ?? undefined,
					);
					total = res.total;
					rows = res.rows;
				} else if (q.sortKey) {
					const end = Math.min(start + CHUNK, this.deps.rowCount());
					rows = (await docGetRowsSorted(
						handle,
						path,
						start,
						end,
						q.sortKey,
						q.sortDesc,
					)) as SortedRow[];
				} else {
					const end = Math.min(start + CHUNK, this.deps.rowCount());
					const raw = await docGetRows(handle, path, start, end);
					rows = raw.map((value, k) => ({ index: start + k, value }));
				}
				// Drop stale responses: if the user retyped the filter or
				// changed query while this was in flight, the in-flight Rust
				// cancel flag might have missed (response already sent), so
				// guard the write here too.
				if (gen !== this.generation) return;
				if (total !== null) this.filteredTotal = total;
				const next = new Map(this.chunks);
				next.set(start, rows);
				this.chunks = next;
			} catch (e) {
				const msg = String(e);
				if (msg.includes('cancelled')) return;
				if (gen !== this.generation) return;
				if (q.sortKey || q.filtering) {
					this.deps.onFilterOverflow(msg.replace(/^.*?Error:\s*/i, ''));
				}
			} finally {
				if (gen === this.generation) this.inFlight.delete(start);
			}
		})();
		this.inFlight.set(start, work);
		this.fetching = true;
		void work.finally(() => {
			if (this.inFlight.size === 0) this.fetching = false;
		});
		return work;
	}

	fetchVisible = () => {
		const first = this.chunkStart(this.rowRange.start);
		const last = this.chunkStart(Math.max(this.rowRange.start, this.rowRange.end - 1));
		for (let s = first; s <= last; s += CHUNK) void this.fetchChunk(s);
	};

	fetchRange = async (lo: number, hi: number) => {
		for (let s = this.chunkStart(lo); s <= this.chunkStart(hi); s += CHUNK) {
			await this.fetchChunk(s);
		}
	};

	setScroll = (top: number, left: number) => {
		this.scrollTop = top;
		this.scrollLeft = left;
	};

	setViewport = (width: number, height: number) => {
		this.viewportWidth = width;
		this.viewportHeight = height;
	};

	reset = () => {
		this.generation += 1;
		if (this.filterJobId) {
			void cancelJob(this.filterJobId);
			this.filterJobId = null;
		}
		this.chunks = new Map();
		this.inFlight.clear();
		this.filteredTotal = null;
		this.fetching = false;
	};
}
