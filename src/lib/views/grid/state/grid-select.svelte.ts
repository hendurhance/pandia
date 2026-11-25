import { SvelteSet } from 'svelte/reactivity';
import { ipc } from '$lib/ipc/client';
import { describeError } from '$lib/ipc/error-copy';
import type { DocHandle, NodeKind, Path } from '$lib/ipc/bindings';
import { UNLOADED, MISSING, inspectorText } from '../logic/grid-cell';
import { kindOf } from '$lib/ipc/wire';
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

	readonly selectedRows = new SvelteSet<number>();
	private selAnchorPos: number | null = null; // visible position of the last click
	readonly rowsCopy = new CopyFlag();
	private clears = 0;

	constructor(private deps: GridSelectDeps) {}

	readonly selectedValue = $derived.by(() => {
		if (!this.selected) return undefined;
		return this.deps.data.getCell(this.selected.row, this.selected.col);
	});

	readonly selectedPath = $derived.by<Path | null>(() => {
		if (!this.selected) return null;
		const orig = this.deps.data.getRow(this.selected.row)?.index;
		if (orig == null) return null;
		return [...this.deps.path(), orig, this.selected.col];
	});

	readonly selectedKind = $derived.by<NodeKind | null>(() => {
		const v = this.selectedValue;
		return v === UNLOADED || v === MISSING || v === undefined ? null : kindOf(v);
	});

	rowSelected = (orig: number | undefined): boolean => orig != null && this.selectedRows.has(orig);

	clearSelection = () => {
		this.selectedRows.clear();
		this.selAnchorPos = null;
		this.clears += 1;
	};

	selectRange = async (a: number, b: number) => {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		const clears = this.clears;
		let indices: number[];
		try {
			indices = await this.deps.data.rowIndices(lo, hi);
		} catch (e) {
			this.deps.onError(describeError(e));
			return;
		}
		if (clears !== this.clears) return;
		for (const i of indices) this.selectedRows.add(i);
	};

	onIndexClick = (e: MouseEvent, pos: number, orig: number) => {
		if (e.shiftKey && this.selAnchorPos != null) {
			void this.selectRange(this.selAnchorPos, pos);
		} else {
			if (this.selectedRows.has(orig)) this.selectedRows.delete(orig);
			else this.selectedRows.add(orig);
			this.selAnchorPos = pos;
		}
	};

	copySelected = async () => {
		const idx = [...this.selectedRows].sort((a, b) => a - b);
		if (idx.length === 0) return;
		try {
			const json = await ipc.docGetRowsAt(this.deps.handle(), this.deps.path(), idx);
			if (!(await this.rowsCopy.copy(json))) this.deps.onError('clipboard unavailable');
		} catch (e) {
			this.deps.onError(describeError(e));
		}
	};

	extractSelected = async () => {
		const idx = [...this.selectedRows].sort((a, b) => a - b);
		if (idx.length === 0) return;
		try {
			const json = await ipc.docGetRowsAt(this.deps.handle(), this.deps.path(), idx);
			this.deps.onExtract(json, idx.length);
		} catch (e) {
			this.deps.onError(describeError(e));
		}
	};

	selectCell = (row: number, col: string) => {
		this.selected = { row, col };
		this.inspectorCopy.done = false;
	};

	copyInspector = async () => {
		const v = this.selectedValue;
		if (v === UNLOADED || v === MISSING || v === undefined) return;
		if (!(await this.inspectorCopy.copy(inspectorText(v)))) {
			this.deps.onError('clipboard unavailable');
		}
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
		this.selectedRows.clear();
		this.selAnchorPos = null;
		this.clears += 1;
	};
}
