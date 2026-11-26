import type { Summary } from '$lib/ipc/bindings';
import type { DefaultView } from '$lib/shell/state/sidebar-prefs.svelte';
import { isContainerKind } from '$lib/views/graph/logic/layout';

export type DefaultViewSummary = Pick<Summary, 'rootKind' | 'rootChildCount' | 'capabilities'>;

export function resolveDefaultView(
	pref: DefaultView,
	summary: DefaultViewSummary | null,
): DefaultView {
	if (summary === null) return pref;
	switch (pref) {
		case 'grid':
			return summary.rootKind === 'array' && (summary.rootChildCount ?? 0) > 0 ? 'grid' : 'tree';
		case 'graph':
			return summary.capabilities.graph && isContainerKind(summary.rootKind) ? 'graph' : 'tree';
		case 'code':
			return summary.capabilities.codeView ? 'code' : 'tree';
		default:
			return pref;
	}
}
