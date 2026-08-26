import type { LineDiffResult, LineHunk } from '$lib/ipc/bindings';

export interface DiffRow {
	type: 'context' | 'add' | 'del';

	leftNo: number | null;
	rightNo: number | null;
}
export interface GapRow {
	type: 'gap';

	count: number;

	leftStart: number;
	rightStart: number;
}
export type UnifiedRow = DiffRow | GapRow;

function contextRow(leftStart: number, rightStart: number, k: number): DiffRow {
	return { type: 'context', leftNo: leftStart + k + 1, rightNo: rightStart + k + 1 };
}

export function gapRows(gap: GapRow): DiffRow[] {
	return Array.from({ length: gap.count }, (_, k) => contextRow(gap.leftStart, gap.rightStart, k));
}

function emitContext(
	out: UnifiedRow[],
	leftStart: number,
	rightStart: number,
	len: number,
	atStart: boolean,
	atEnd: boolean,
	ctx: number,
) {
	if (len <= 0) return;
	if (atStart) {
		const keep = Math.min(ctx, len);
		if (len - keep > 0) {
			out.push({ type: 'gap', count: len - keep, leftStart, rightStart });
		}
		for (let k = len - keep; k < len; k++) out.push(contextRow(leftStart, rightStart, k));
		return;
	}
	if (atEnd) {
		const keep = Math.min(ctx, len);
		for (let k = 0; k < keep; k++) out.push(contextRow(leftStart, rightStart, k));
		if (len - keep > 0) {
			out.push({
				type: 'gap',
				count: len - keep,
				leftStart: leftStart + keep,
				rightStart: rightStart + keep,
			});
		}
		return;
	}
	if (len <= ctx * 2) {
		for (let k = 0; k < len; k++) out.push(contextRow(leftStart, rightStart, k));
		return;
	}
	for (let k = 0; k < ctx; k++) out.push(contextRow(leftStart, rightStart, k));
	out.push({
		type: 'gap',
		count: len - ctx * 2,
		leftStart: leftStart + ctx,
		rightStart: rightStart + ctx,
	});
	for (let k = len - ctx; k < len; k++) out.push(contextRow(leftStart, rightStart, k));
}

export function unifiedRows(diff: LineDiffResult, ctx = 3): UnifiedRow[] {
	const { hunks } = diff;
	if (hunks.length === 0) return [];
	const out: UnifiedRow[] = [];
	let l = 0;
	let r = 0;
	for (let i = 0; i < hunks.length; i++) {
		const h = hunks[i];
		if (!h) continue;
		emitContext(out, l, r, h.leftStart - l, i === 0, false, ctx);
		for (let k = 0; k < h.leftLen; k++) {
			out.push({ type: 'del', leftNo: h.leftStart + k + 1, rightNo: null });
		}
		for (let k = 0; k < h.rightLen; k++) {
			out.push({ type: 'add', leftNo: null, rightNo: h.rightStart + k + 1 });
		}
		l = h.leftStart + h.leftLen;
		r = h.rightStart + h.rightLen;
	}
	emitContext(out, l, r, diff.leftLines - l, false, true, ctx);
	return out;
}

export function changeCounts(hunks: LineHunk[]): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const h of hunks) {
		adds += h.rightLen;
		dels += h.leftLen;
	}
	return { adds, dels };
}

const ANCHOR_CHUNK = 50;

export function changeAnchors(rows: UnifiedRow[]): number[] {
	const anchors: number[] = [];
	let runLen = 0;
	rows.forEach((r, idx) => {
		const isChange = r.type === 'add' || r.type === 'del';
		if (!isChange) {
			runLen = 0;
			return;
		}
		if (runLen === 0 || runLen >= ANCHOR_CHUNK) {
			anchors.push(idx);
			runLen = 0; // restart the chunk window so the next anchor is ~ANCHOR_CHUNK later
		}
		runLen++;
	});
	return anchors;
}
