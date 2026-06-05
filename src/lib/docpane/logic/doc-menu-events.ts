import type { DocPaneActions } from './doc-actions';

function cycleFind(actions: DocPaneActions, dir: 1 | -1): void {
	const { find } = actions;
	const hasHits = actions.isCodeView() ? find.codeMatchCount > 0 : find.hits.length > 0;
	if (!hasHits) {
		find.openFind();
		return;
	}
	find.open = true;
	if (dir === 1) find.next();
	else find.prev();
}

const ROUTES: Record<string, (a: DocPaneActions) => void> = {
	toggle_tree_view: (a) => a.switchView('tree'),
	toggle_code_view: (a) => a.switchView('code'),
	toggle_form_view: (a) => a.switchView('grid'),
	toggle_graph_view: (a) => a.switchView('graph'),
	undo: (a) => a.undo(),
	redo: (a) => a.redo(),
	save_file: (a) => a.doSave(),
	save_as: (a) => a.doSaveAs(),
	export_doc: (a) => a.openExport(),
	find: (a) => a.find.openFind(),
	find_replace: (a) => a.find.openFind(),
	find_next: (a) => cycleFind(a, 1),
	find_prev: (a) => cycleFind(a, -1),
};

export function handleDocMenuEvent(id: string, actions: DocPaneActions): void {
	ROUTES[id]?.(actions);
}
