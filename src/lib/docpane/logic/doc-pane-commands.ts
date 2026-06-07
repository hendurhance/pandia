import type { Command } from '$lib/palette/state/command-store.svelte';
import type { ContentRow } from '$lib/views/tree/logic/model';
import type { TypegenLang } from '$lib/ipc/types';
import type { DocPaneActions } from './doc-actions';

const TYPEGEN_TARGETS: Array<[TypegenLang, string]> = [
	['typescript', 'TypeScript'],
	['rust', 'Rust'],
	['go', 'Go'],
	['kotlin', 'Kotlin'],
	['json-schema', 'JSON Schema'],
	['python', 'Python'],
	['php', 'PHP'],
	['java', 'Java'],
	['zod', 'Zod'],
];

export function createDocPaneCommands(actions: DocPaneActions): Command[] {
	const withRow = (fn: (r: ContentRow) => void) => () => {
		const r = actions.selectedContentRow();
		if (r) fn(r);
	};

	return [
		{
			id: 'doc.save',
			label: 'Save Document',
			category: 'Document',
			keybinding: '⌘S',
			enabled: actions.hasDoc,
			run: () => actions.doSave(),
		},
		{
			id: 'doc.saveAs',
			label: 'Save Document As…',
			category: 'Document',
			keybinding: '⌘⇧S',
			enabled: actions.hasDoc,
			run: () => actions.doSaveAs(),
		},
		{
			id: 'doc.export',
			label: 'Export (JSON · YAML · CSV · XML)…',
			category: 'Import / Export',
			keybinding: '⌘E',
			enabled: actions.hasDoc,
			run: () => actions.openExport(),
		},
		{
			id: 'view.tree',
			label: 'Tree View',
			category: 'View',
			keybinding: '⌘1',
			run: () => actions.switchView('tree'),
		},
		{
			id: 'view.code',
			label: 'Code View',
			category: 'View',
			keybinding: '⌘2',
			enabled: actions.hasDoc,
			run: () => actions.switchView('code'),
		},
		{
			id: 'view.grid',
			label: 'Grid View',
			category: 'View',
			keybinding: '⌘3',
			enabled: actions.hasDoc,
			run: () => actions.switchView('grid'),
		},
		{
			id: 'view.graph',
			label: 'Graph View',
			category: 'View',
			keybinding: '⌘4',
			enabled: actions.hasDoc,
			run: () => actions.switchView('graph'),
		},
		{
			id: 'doc.undo',
			label: 'Undo',
			category: 'Document',
			keybinding: '⌘Z',
			enabled: actions.hasDoc,
			run: () => actions.undo(),
		},
		{
			id: 'doc.redo',
			label: 'Redo',
			category: 'Document',
			keybinding: '⌘⇧Z',
			enabled: actions.hasDoc,
			run: () => actions.redo(),
		},
		{
			id: 'doc.close',
			label: 'Close Document',
			category: 'Document',
			enabled: actions.hasDoc,
			run: () => actions.close(),
		},
		{
			id: 'nav.goToPath',
			label: 'Go to Path…',
			category: 'Navigate',
			enabled: actions.hasDoc,
			run: () => actions.goToPath(),
		},
		{
			id: 'find.open',
			label: 'Find in Document…',
			category: 'Navigate',
			keybinding: '⌘F',
			enabled: actions.hasDoc,
			run: () => actions.find.openFind(),
		},
		{
			id: 'find.next',
			label: 'Find Next',
			category: 'Navigate',
			keybinding: '⌘G',
			enabled: () => actions.find.hits.length > 0,
			run: () => actions.find.next(),
		},
		{
			id: 'find.prev',
			label: 'Find Previous',
			category: 'Navigate',
			keybinding: '⌘⇧G',
			enabled: () => actions.find.hits.length > 0,
			run: () => actions.find.prev(),
		},
		{
			id: 'tree.expandAll',
			label: 'Expand All',
			category: 'Navigate',
			enabled: () => actions.hasDoc() && !actions.expandAllDisabled(),
			run: () => actions.onExpandAll(),
		},
		{
			id: 'tree.collapseAll',
			label: 'Collapse All',
			category: 'Navigate',
			enabled: actions.hasDoc,
			run: () => actions.onCollapseAll(),
		},
		{
			id: 'tree.moveUp',
			label: 'Move Row Up',
			category: 'Document',
			enabled: () => {
				const r = actions.selectedContentRow();
				return !!r && r.depth > 0 && actions.moveBounds(r).up;
			},
			run: withRow((r) => actions.menuMove(r, -1)),
		},
		{
			id: 'tree.moveDown',
			label: 'Move Row Down',
			category: 'Document',
			enabled: () => {
				const r = actions.selectedContentRow();
				return !!r && r.depth > 0 && actions.moveBounds(r).down;
			},
			run: withRow((r) => actions.menuMove(r, 1)),
		},
		{
			id: 'tree.sortKeysAsc',
			label: 'Sort Keys (A→Z)',
			category: 'Document',
			enabled: () => actions.selectedContentRow()?.kind === 'object',
			run: withRow((r) => actions.menuSortKeys(r, false)),
		},
		{
			id: 'tree.sortKeysDesc',
			label: 'Sort Keys (Z→A)',
			category: 'Document',
			enabled: () => actions.selectedContentRow()?.kind === 'object',
			run: withRow((r) => actions.menuSortKeys(r, true)),
		},
		{
			id: 'edit.copy',
			label: 'Copy Value (JSON)',
			category: 'Document',
			enabled: () => !!actions.selectedContentRow(),
			run: withRow((r) => actions.menuCopy(r)),
		},
		{
			id: 'edit.copyPath',
			label: 'Copy Path',
			category: 'Document',
			enabled: () => !!actions.selectedContentRow(),
			run: withRow((r) => actions.menuCopyPath(r)),
		},
		{
			id: 'edit.cut',
			label: 'Cut',
			category: 'Document',
			enabled: () => (actions.selectedContentRow()?.depth ?? 0) > 0,
			run: withRow((r) => actions.menuCut(r)),
		},
		{
			id: 'edit.paste',
			label: 'Paste as Sibling',
			category: 'Document',
			enabled: () => (actions.selectedContentRow()?.depth ?? 0) > 0,
			run: withRow((r) => actions.menuPaste(r)),
		},
		{
			id: 'edit.extract',
			label: 'Extract to New Tab',
			category: 'Document',
			enabled: () => !!actions.selectedContentRow(),
			run: withRow((r) => actions.menuExtract(r)),
		},
		...TYPEGEN_TARGETS.map(
			([lang, label]): Command => ({
				id: `generate.types.${lang}`,
				label: `Generate ${label}`,
				category: 'Generate',
				enabled: actions.hasDoc,
				run: () => actions.showTypegen(lang),
			}),
		),
		{
			id: 'compare.with',
			label: 'Diff Against File…',
			category: 'Compare',
			enabled: () => actions.hasDoc() && !actions.inCompare(),
			run: () => actions.onPickCompareFile(),
		},
		{
			id: 'compare.exit',
			label: 'Exit Compare',
			category: 'Compare',
			enabled: actions.inCompare,
			run: () => actions.exitCompare(),
		},
	];
}
