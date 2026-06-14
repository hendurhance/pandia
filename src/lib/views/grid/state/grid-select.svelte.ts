import { docGetRowsAt } from '$lib/ipc/doc';
import type { DocHandle, NodeKind, Path } from '$lib/ipc/types';
import { UNLOADED, MISSING, inspectorText, valueKind } from '../logic/grid-cell';
import { CopyFlag } from '$lib/util/clipboard.svelte';
import type { GridDataController } from './grid-data.svelte';

export interface GridSelectDeps {
	data: GridDataController;
	handle: () => DocHandle;
	path: () => Path;
	onExtract: (text: string, count: number) => void;
	onOpenInTree: (cellPath: Path) => void;
	onError: (msg: string) => void;
}

export class GridSelectionController {
	selected: { row: number; col: string } | null = $state(null);
	readonly inspectorCopy = new CopyFlag();

	selectedRows = $state(new Set<number>());
	private selAnchorPos: number | null = null; // visible position of the last click
	readonly rowsCopy = new CopyFlag();

	constructor(private deps: GridSelectDeps) {}

	readonly selectedValue = $derived.by(() => {
		if (!this.selected) return undefined;
		void this.deps.data.chunks; // re-read when the chunk (re)loads
		return this.deps.data.getCell(this.selected.row, this.selected.col);
	});

	readonly selectedPath = $derived.by<Path | null>(() => {
		if (!this.selected) return null;
		void this.deps.data.chunks; // re-read once the row's chunk loads
		const orig = this.deps.data.getRow(this.selected.row)?.index;
		if (orig == null) return null;
		return [...this.deps.path(), orig, this.selected.col];
	});

	readonly selectedKind = $derived.by<NodeKind | null>(() => {
		const v = this.selectedValue;
		return v === UNLOADED || v === MISSING || v === undefined ? null : valueKind(v);
	});

	rowSelected = (orig: number | undefined): boolean => orig != null && this.selectedRows.has(orig);

	clearSelection = () => {
		this.selectedRows = new Set();
		this.selAnchorPos = null;
	};

	selectRange = async (a: number, b: number) => {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		await this.deps.data.fetchRange(lo, hi);
		const next = new Set(this.selectedRows);
		for (let pos = lo; pos <= hi; pos++) {
			const r = this.deps.data.getRow(pos);
			if (r) next.add(r.index);
		}
		this.selectedRows = next;
	};

	onIndexClick = (e: MouseEvent, pos: number, orig: number) => {
		if (e.shiftKey && this.selAnchorPos != null) {
			void this.selectRange(this.selAnchorPos, pos);
		} else {
			const next = new Set(this.selectedRows);
			if (next.has(orig)) next.delete(orig);
			else next.add(orig);
			this.selectedRows = next;
			this.selAnchorPos = pos;
		}
	};

	copySelected = async () => {
		const idx = [...this.selectedRows].sort((a, b) => a - b);
		if (idx.length === 0) return;
		try {
			// Pretty JSON serialized in Rust — big integers survive (JSON.stringify of
			// an IPC-parsed value would truncate them through f64).
			const json = await docGetRowsAt(this.deps.handle(), this.deps.path(), idx);
			if (!(await this.rowsCopy.copy(json))) this.deps.onError('clipboard unavailable');
		} catch (e) {
			this.deps.onError(String(e));
		}
	};

	extractSelected = async () => {
		const idx = [...this.selectedRows].sort((a, b) => a - b);
		if (idx.length === 0) return;
		try {
			const json = await docGetRowsAt(this.deps.handle(), this.deps.path(), idx);
			this.deps.onExtract(json, idx.length);
		} catch (e) {
			this.deps.onError(String(e));
		}
	};

	selectCell = (row: number, col: string) => {
		this.selected = { row, col };
		this.inspectorCopy.done = false;
	};

	copyInspector = async () => {
		const v = this.selectedValue;
		if (v === UNLOADED || v === MISSING || v === undefined) return;
		await this.inspectorCopy.copy(inspectorText(v));
	};

	openSelectedInTree = () => {
		if (this.selectedPath) this.deps.onOpenInTree(this.selectedPath);
	};

	onCellKeydown = (e: KeyboardEvent, row: number, col: string) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.selectCell(row, col);
		}
	};

	reset = () => {
		this.selected = null;
		this.selectedRows = new Set();
		this.selAnchorPos = null;
	};
}
