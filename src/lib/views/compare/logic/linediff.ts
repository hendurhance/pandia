export interface DiffRow {
	type: 'context' | 'add' | 'del';
	text: string;
	
	leftNo: number | null;
	rightNo: number | null;
}
export interface GapRow {
	type: 'gap';
	
	count: number;
	
	lines: DiffRow[];
}
export type UnifiedRow = DiffRow | GapRow;

const LCS_CELL_CAP = 4_000_000;

type Op = { type: 'context' | 'add' | 'del'; text: string };

function diffMiddle(a: string[], b: string[]): Op[] {
	const A = a.length;
	const B = b.length;
	if (A === 0) return b.map((text) => ({ type: 'add', text }));
	if (B === 0) return a.map((text) => ({ type: 'del', text }));
	if (A * B > LCS_CELL_CAP) {
		return [
			...a.map((text): Op => ({ type: 'del', text })),
			...b.map((text): Op => ({ type: 'add', text })),
		];
	}

	const dp: Uint32Array[] = Array.from({ length: A + 1 }, () => new Uint32Array(B + 1));
	for (let i = A - 1; i >= 0; i--) {
		const row = dp[i];
		const next = dp[i + 1];
		for (let j = B - 1; j >= 0; j--) {
			row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
		}
	}

	const ops: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < A && j < B) {
		if (a[i] === b[j]) {
			ops.push({ type: 'context', text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ type: 'del', text: a[i] });
			i++;
		} else {
			ops.push({ type: 'add', text: b[j] });
			j++;
		}
	}
	while (i < A) ops.push({ type: 'del', text: a[i++] });
	while (j < B) ops.push({ type: 'add', text: b[j++] });
	return ops;
}

function fullRows(leftText: string, rightText: string): DiffRow[] {
	const L = leftText.split('\n');
	const R = rightText.split('\n');
	const n = L.length;
	const m = R.length;

	let pre = 0;
	while (pre < n && pre < m && L[pre] === R[pre]) pre++;
	let endL = n;
	let endR = m;
	while (endL > pre && endR > pre && L[endL - 1] === R[endR - 1]) {
		endL--;
		endR--;
	}

	const rows: DiffRow[] = [];
	let ln = 0;
	let rn = 0;

	for (let i = 0; i < pre; i++) {
		rows.push({ type: 'context', text: L[i], leftNo: ++ln, rightNo: ++rn });
	}
	for (const op of diffMiddle(L.slice(pre, endL), R.slice(pre, endR))) {
		if (op.type === 'context') {
			rows.push({ type: 'context', text: op.text, leftNo: ++ln, rightNo: ++rn });
		} else if (op.type === 'del') {
			rows.push({ type: 'del', text: op.text, leftNo: ++ln, rightNo: null });
		} else {
			rows.push({ type: 'add', text: op.text, leftNo: null, rightNo: ++rn });
		}
	}
	for (let i = endL; i < n; i++) {
		rows.push({ type: 'context', text: L[i], leftNo: ++ln, rightNo: ++rn });
	}
	return rows;
}

function emitContext(
	out: UnifiedRow[],
	run: DiffRow[],
	atStart: boolean,
	atEnd: boolean,
	ctx: number,
) {
	const len = run.length;
	if (atStart && atEnd) {
		if (len > 0) out.push({ type: 'gap', count: len, lines: run.slice() });
		return;
	}
	if (atStart) {
		const keep = Math.min(ctx, len);
		if (len - keep > 0) {
			out.push({ type: 'gap', count: len - keep, lines: run.slice(0, len - keep) });
		}
		for (let k = len - keep; k < len; k++) out.push(run[k]);
		return;
	}
	if (atEnd) {
		const keep = Math.min(ctx, len);
		for (let k = 0; k < keep; k++) out.push(run[k]);
		if (len - keep > 0) {
			out.push({ type: 'gap', count: len - keep, lines: run.slice(keep) });
		}
		return;
	}
	if (len <= ctx * 2) {
		for (const r of run) out.push(r);
		return;
	}
	for (let k = 0; k < ctx; k++) out.push(run[k]);
	out.push({
		type: 'gap',
		count: len - ctx * 2,
		lines: run.slice(ctx, len - ctx),
	});
	for (let k = len - ctx; k < len; k++) out.push(run[k]);
}

export function unifiedDiff(leftText: string, rightText: string, ctx = 3): UnifiedRow[] {
	const full = fullRows(leftText, rightText);
	if (!full.some((r) => r.type !== 'context')) return [];

	const out: UnifiedRow[] = [];
	let i = 0;
	while (i < full.length) {
		if (full[i].type !== 'context') {
			out.push(full[i]);
			i++;
			continue;
		}
		let j = i;
		while (j < full.length && full[j].type === 'context') j++;
		emitContext(out, full.slice(i, j) as DiffRow[], i === 0, j === full.length, ctx);
		i = j;
	}
	return out;
}

export function changeCounts(rows: UnifiedRow[]): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const r of rows) {
		if (r.type === 'add') adds++;
		else if (r.type === 'del') dels++;
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
		if (runLen === 0 || runLen >= ANCHOR_CHUNK) anchors.push(idx);
		runLen++;
	});
	return anchors;
}
