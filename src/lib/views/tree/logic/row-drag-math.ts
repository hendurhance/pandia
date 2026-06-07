import type { ContentRow, Row } from './model';

export function siblingSlots(
	rows: Row[],
	di: number,
): { slots: number[]; endIndex: number } | null {
	const dragged = rows[di];
	if (!dragged || dragged.variant !== 'content' || dragged.depth === 0) return null;
	const dd = dragged.depth;
	let pi = di - 1;
	while (pi >= 0 && !(rows[pi].variant === 'content' && rows[pi].depth === dd - 1)) pi--;
	if (pi < 0) return null;
	const slots: number[] = [];
	let i = pi + 1;
	for (; i < rows.length; i++) {
		const r = rows[i];
		if (r.depth <= dd - 1) break; // parent's close row → end of the sibling region
		if ((r.variant === 'content' || r.variant === 'placeholder') && r.depth === dd) {
			slots.push(i);
		}
	}
	return { slots, endIndex: i };
}

export function gapAt(
	rows: Row[],
	offsets: ArrayLike<number>,
	di: number,
	contentY: number,
): { gap: number; y: number; depth: number } | null {
	const info = siblingSlots(rows, di);
	if (!info) return null;
	const { slots, endIndex } = info;
	const dd = (rows[di] as ContentRow).depth;
	let best = 0;
	let bestDist = Infinity;
	for (let g = 0; g <= slots.length; g++) {
		const rowIdx = g < slots.length ? slots[g] : endIndex;
		const dist = Math.abs(contentY - (offsets[rowIdx] ?? 0));
		if (dist < bestDist) {
			bestDist = dist;
			best = g;
		}
	}
	const rowIdx = best < slots.length ? slots[best] : endIndex;
	return { gap: best, y: offsets[rowIdx] ?? 0, depth: dd };
}

export const ROW_DRAG_EDGE_ZONE = 36;
export const ROW_DRAG_MAX_STEP = 14;
