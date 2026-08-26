import type { Path } from '$lib/ipc/bindings';
import type { Row } from './model';

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
