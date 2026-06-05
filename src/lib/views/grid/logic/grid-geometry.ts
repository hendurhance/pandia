import type { Column, NodeKind } from '$lib/ipc/types';

export const PX_PER_CH = 7.6;
const CELL_PAD_CH = 2;
const MIN_COL_CH = 8;
const MAX_COL_CH = 48;
const HEADER_AFFORDANCE_CH = 5;

export interface ColumnLayout {
	
	widths: number[];
	
	offsets: number[];
	
	total: number;
}

export interface VisibleRange {
	start: number;
	end: number;
}

export function kindIdealCh(kind: NodeKind): number {
	switch (kind) {
		case 'number':
			return 12;
		case 'bool':
			return 5;
		case 'null':
			return 4;
		case 'string':
			return 24;
		case 'object':
		case 'array':
			return 14;
	}
}

export function idealCh(col: Column): number {
	const labelCh = col.key.length + 2; // room for the sort arrow
	const kindCh = kindIdealCh(col.dominantKind);
	const ch = Math.max(MIN_COL_CH, labelCh, kindCh);
	return Math.min(MAX_COL_CH, ch + CELL_PAD_CH);
}

export function autoFitWidthPx(
	col: Column,
	cellTexts: string[],
	minPx: number,
	maxPx: number,
): number {
	let ch =
		col.key.length + HEADER_AFFORDANCE_CH + (col.kinds.length > 1 ? 2 : 0) + (col.nullable ? 2 : 0);
	for (const t of cellTexts) if (t.length > ch) ch = t.length;
	const px = (ch + CELL_PAD_CH) * PX_PER_CH;
	return Math.round(Math.min(maxPx, Math.max(minPx, px)));
}

export function computeColumnLayout(
	columns: Column[],
	overrides: Map<string, number>,
): ColumnLayout {
	const widths = columns.map((c) => overrides.get(c.key) ?? idealCh(c) * PX_PER_CH);
	const offsets = new Array<number>(widths.length);
	let acc = 0;
	for (let i = 0; i < widths.length; i++) {
		offsets[i] = acc;
		acc += widths[i];
	}
	return { widths, offsets, total: acc };
}

export function columnWindow(
	layout: ColumnLayout,
	scrollLeft: number,
	viewportWidth: number,
	overscan: number,
): VisibleRange {
	const { offsets, widths } = layout;
	if (widths.length === 0) return { start: 0, end: 0 };
	let start = 0;
	while (start < widths.length && offsets[start] + widths[start] <= scrollLeft) start++;
	const right = scrollLeft + viewportWidth;
	let end = start;
	while (end < widths.length && offsets[end] < right) end++;
	return {
		start: Math.max(0, start - overscan),
		end: Math.min(widths.length, end + overscan),
	};
}

export function rowWindow(
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	rowCount: number,
	overscan: number,
): VisibleRange {
	const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
	const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
	return { start, end };
}
