import type { TreeRowsController } from '../../views/tree/state/tree-rows.svelte';
import { isContent, isExpandable, rootRow } from '../../views/tree/logic/model';
import type { NodeKind, Path } from '../../ipc/types';

export const SAFETY_PASSES = 100;

export interface BulkExpandDeps {
	tree: Pick<TreeRowsController, 'rows' | 'contentRowIdx' | 'toggleAt'>;

	setBusy: (b: boolean) => void;
}

export async function expandAll(deps: BulkExpandDeps): Promise<void> {
	deps.setBusy(true);
	try {
		let pass = 0;
		while (pass < SAFETY_PASSES) {
			const targets: Path[] = [];
			for (const r of deps.tree.rows) {
				if (isContent(r) && isExpandable(r) && !r.expanded) {
					targets.push(r.path);
				}
			}
			if (targets.length === 0) break;
			for (const p of targets) {
				const idx = deps.tree.contentRowIdx(p);
				if (idx < 0) continue;
				const cur = deps.tree.rows[idx];
				// Re-check expansion state — a previous toggle in this same loop
				if (cur.variant === 'content' && isExpandable(cur) && !cur.expanded) {
					await deps.tree.toggleAt(idx);
				}
			}
			pass++;
		}
	} finally {
		deps.setBusy(false);
	}
}

export interface BulkCollapseDeps {
	tree: Pick<TreeRowsController, 'setRows' | 'toggleAt'>;
	summary: { rootKind: NodeKind; rootChildCount: number | null } | null;

	selectPath: (p: Path) => void;
}

export async function collapseAll(deps: BulkCollapseDeps): Promise<void> {
	if (!deps.summary) return;
	const root = rootRow(deps.summary.rootKind, deps.summary.rootChildCount);
	deps.tree.setRows([root]);
	deps.selectPath(root.path);
	if (isExpandable(root)) {
		await deps.tree.toggleAt(0);
	}
}
