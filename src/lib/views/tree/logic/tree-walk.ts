import type { Op, Path, PathSegment } from '$lib/ipc/bindings';
import { pathKey, type Row } from './model';

export function collectExpandedDescendants(
	rows: ReadonlyArray<Row>,
	idx: number,
	baseDepth: number,
): Path[] {
	const out: Path[] = [];
	for (let i = idx + 1; i < rows.length; i++) {
		const r = rows[i];
		if (!r) break;
		if (r.depth <= baseDepth) break; // left the subtree
		if (r.variant === 'content' && r.expanded) out.push(r.path);
	}
	return out;
}

function indexAfterOp(i: number, op: Op): number | null {
	switch (op.kind) {
		case 'insertItemText':
			return i >= op.index ? i + 1 : i;
		case 'duplicateItem':
			return i > op.index ? i + 1 : i;
		case 'deleteItem':
			if (i === op.index) return null;
			return i > op.index ? i - 1 : i;
		case 'moveItem':
			if (i === op.from) return op.to;
			if (op.from < i && i <= op.to) return i - 1;
			if (op.to <= i && i < op.from) return i + 1;
			return i;
		default:
			return i;
	}
}

export function pathAfterOp(path: Path, op: Op): Path | null {
	const d = op.path.length;
	if (path.length < d || op.path.some((seg, i) => path[i] !== seg)) return path;
	if (op.kind === 'setValueText') return null;
	const seg = path[d];
	if (seg === undefined) return path;
	let to: PathSegment | null = seg;
	if (typeof seg === 'number') to = indexAfterOp(seg, op);
	else if (op.kind === 'deleteKey' && seg === op.key) to = null;
	else if (op.kind === 'renameKey' && seg === op.from) to = op.to;
	if (to === null) return null;
	return to === seg ? path : [...path.slice(0, d), to, ...path.slice(d + 1)];
}

export function remapAfterOp(
	paths: Path[],
	container: Path,
	op: Op | undefined,
	sameLength: boolean,
): Path[] {
	const d = container.length;
	const onContainer = op !== undefined && pathKey(op.path) === pathKey(container);
	const out: Path[] = [];
	for (const p of paths) {
		const seg = p[d];
		if (typeof seg !== 'number' || (op === undefined && sameLength)) {
			out.push(p);
			continue;
		}
		if (op === undefined) continue;
		const to = onContainer ? indexAfterOp(seg, op) : seg;
		if (to === null) continue;
		out.push(to === seg ? p : [...p.slice(0, d), to, ...p.slice(d + 1)]);
	}
	return out;
}
