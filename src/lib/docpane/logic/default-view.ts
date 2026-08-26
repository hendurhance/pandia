import type { NodeKind } from '$lib/ipc/bindings';
import type { DefaultView } from '$lib/shell/state/sidebar-prefs.svelte';
import { isContainerKind } from '$lib/views/graph/logic/layout';

export const CODE_VIEW_MAX_BYTES = 50 * 1024 * 1024;

export interface DefaultViewSummary {
	rootKind: NodeKind;
	rootChildCount: number | null;
	sourceSize: number;
}

export function resolveDefaultView(
	pref: DefaultView,
	summary: DefaultViewSummary | null,
): DefaultView {
	if (summary === null) return pref;
	switch (pref) {
		case 'grid':
			return summary.rootKind === 'array' && (summary.rootChildCount ?? 0) > 0 ? 'grid' : 'tree';
		case 'graph':
			return isContainerKind(summary.rootKind) ? 'graph' : 'tree';
		case 'code':
			return summary.sourceSize <= CODE_VIEW_MAX_BYTES ? 'code' : 'tree';
		default:
			return pref;
	}
}
