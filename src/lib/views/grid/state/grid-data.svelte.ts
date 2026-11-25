import { SvelteSet } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { ipc } from '$lib/ipc/client';
import type { DocHandle, GridFilter, Path, RowJson } from '$lib/ipc/bindings';
import { decodeLossless, kindOf } from '$lib/ipc/wire';
import { IpcError } from '$lib/ipc/error';
import { describeError } from '$lib/ipc/error-copy';
import { PagedSource } from '$lib/views/shared/paged-source.svelte';
import { WindowedScroller } from '$lib/views/shared/windowed-scroller.svelte';
import { MAX_SCROLL_HEIGHT, fixedWindow, scaledOffset } from '$lib/views/shared/scroll-math';
import { UNLOADED, MISSING, cellText } from '../logic/grid-cell';

export const ROW_HEIGHT = 24;
const ROW_OVERSCAN = 8;
const CHUNK = 100;

export interface GridRow {
	index: number;
	value: unknown;
}

function cellOf(v: unknown, colKey: string): unknown {
	return kindOf(v) === 'object' && Object.hasOwn(v as object, colKey)
		? (v as Record<string, unknown>)[colKey]
		: MISSING;
}

export interface GridQuery {
	sortKey: string | null;
	sortDesc: boolean;

	filterGroups: GridFilter[][];

	quick: string;
	quickKeys: string[];
	filtering: boolean;
}

function engineQuery(q: GridQuery) {
	return {
		groups: q.filterGroups,
		quick: q.quick.trim() || null,
		quickKeys: q.quickKeys,
		sortKey: q.sortKey,
		descending: q.sortDesc,
	};
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
	private readonly filterJobIds = new SvelteSet<string>();

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
				const jobId = crypto.randomUUID();
				this.filterJobIds.add(jobId);
				try {
					const res = await ipc.docGetRowsFiltered(handle, path, start, end, engineQuery(q), jobId);
					return { items: res.rows.map(decodeRow), total: res.total };
				} finally {
					this.filterJobIds.delete(jobId);
				}
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
			for (const id of this.filterJobIds) void ipc.cancelJob(id);
			this.filterJobIds.clear();
		},
	});

	readonly scroller = new WindowedScroller({
		rowCount: () => this.effectiveRowCount,
		rowHeight: ROW_HEIGHT,
	});

	private heldTotal: number | null = $state(null);
	private heldFor = '';

	constructor(private deps: GridDataDeps) {}

	get chunks(): ReadonlyMap<number, GridRow[]> {
		return this.source.pages;
	}

	get filteredTotal(): number | null {
		return this.source.total ?? this.heldTotal;
	}

	get fetching(): boolean {
		return this.source.fetching;
	}

	readonly effectiveRowCount = $derived.by(() =>
		this.deps.query().filtering ? (this.filteredTotal ?? 0) : this.deps.rowCount(),
	);

	readonly contentHeight = $derived(
		Math.min(this.effectiveRowCount * ROW_HEIGHT, MAX_SCROLL_HEIGHT),
	);

	private readonly offset = $derived(
		scaledOffset(
			this.scroller.scrollTop,
			this.scroller.viewportHeight,
			this.effectiveRowCount * ROW_HEIGHT,
		),
	);

	private readonly shift = $derived(this.offset - this.scroller.scrollTop);

	readonly window = $derived(
		fixedWindow(
			this.offset,
			this.scroller.viewportHeight,
			this.effectiveRowCount,
			ROW_HEIGHT,
			ROW_OVERSCAN,
		),
	);

	readonly visibleRows = $derived(
		Array.from(
			{ length: Math.max(0, this.window.end - this.window.start) },
			(_, k) => this.window.start + k,
		),
	);

	rowTop = (rowIdx: number): number => rowIdx * ROW_HEIGHT - this.shift;

	chunkStart = (i: number): number => this.source.pageStart(i);

	getRow = (rowIdx: number): GridRow | undefined => this.source.get(rowIdx);

	getCell = (rowIdx: number, colKey: string): unknown => {
		const row = this.getRow(rowIdx);
		if (!row) return UNLOADED;
		return cellOf(row.value, colKey);
	};

	setCell = (index: number, colKey: string, value: unknown) => {
		for (const [start, rows] of this.source.pages) {
			const at = rows.findIndex((r) => r.index === index);
			const row = rows[at];
			if (!row) continue;
			const patched = [...rows];
			patched[at] = { index, value: { ...(row.value as object), [colKey]: value } };
			this.source.pages.set(start, patched);
			return;
		}
	};

	loadedColumnTexts = (colKey: string): string[] => {
		const out: string[] = [];
		for (const rows of this.chunks.values()) {
			for (const row of rows) {
				const cell = cellOf(row.value, colKey);
				if (cell !== MISSING) out.push(cellText(cell));
			}
		}
		return out;
	};

	fetchVisible = () => {
		const range = this.window;
		this.source.ensureVisible(range.start, range.end);
	};

	fetchRange = async (lo: number, hi: number) => {
		await this.source.ensureRange(lo, hi + 1);
	};

	rowIndices = (lo: number, hi: number): Promise<number[]> =>
		ipc.docGetRowIndices(
			this.deps.handle(),
			this.deps.path(),
			lo,
			hi + 1,
			engineQuery(this.deps.query()),
		);

	reset = () => {
		untrack(() => {
			const key = JSON.stringify([this.deps.handle(), this.deps.query()]);
			this.heldTotal = key === this.heldFor ? this.filteredTotal : null;
			this.heldFor = key;
		});
		this.source.reset();
	};
}
