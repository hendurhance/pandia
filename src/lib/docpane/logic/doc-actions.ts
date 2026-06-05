import type { FindController } from '$lib/find/state/find.svelte';
import type { ContentRow } from '$lib/views/tree/logic/model';
import type { TypegenLang } from '$lib/ipc/types';

export type SwitchableView = 'tree' | 'code' | 'grid' | 'graph';

export interface DocPaneActions {
	hasDoc: () => boolean;
	isCodeView: () => boolean;
	expandAllDisabled: () => boolean;
	inCompare: () => boolean;
	find: FindController;
	selectedContentRow: () => ContentRow | null;
	moveBounds: (r: ContentRow) => { up: boolean; down: boolean };
	doSave: () => void;
	doSaveAs: () => void;
	openExport: () => void;
	switchView: (mode: SwitchableView) => void;
	undo: () => void;
	redo: () => void;
	close: () => void;
	goToPath: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	menuMove: (r: ContentRow, dir: 1 | -1) => void;
	menuSortKeys: (r: ContentRow, desc: boolean) => void;
	menuCopy: (r: ContentRow) => void;
	menuCopyPath: (r: ContentRow) => void;
	menuCut: (r: ContentRow) => void;
	menuPaste: (r: ContentRow) => void;
	menuExtract: (r: ContentRow) => void;
	showTypegen: (lang: TypegenLang) => void;
	onPickCompareFile: () => void;
	exitCompare: () => void;
}
