import type { Path } from '$lib/ipc/types';
import type { Row } from './model';

export function collectExpandedDescendants(
	rows: ReadonlyArray<Row>,
	idx: number,
	baseDepth: number,
): Path[] {
	const out: Path[] = [];
	for (let i = idx + 1; i < rows.length; i++) {
		const r = rows[i];
		if (r.depth <= baseDepth) break; // left the subtree
		if (r.variant === 'content' && r.expanded) out.push(r.path);
	}
	return out;
}
