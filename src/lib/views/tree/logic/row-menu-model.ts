import type { ContentRow, MenuAction } from './model';
import type { NodeKind } from '$lib/ipc/types';

export interface MenuLeaf {
	type: 'action';
	action: MenuAction;
	label: string;
	ico: string;
	danger?: boolean;
}
export interface MenuSub {
	type: 'sub';
	label: string;
	ico: string;
	children: Array<{ action: MenuAction; label: string; disabled?: boolean }>;
}
export type MenuItem = MenuLeaf | MenuSub;
export type MenuGroup = MenuItem[];

export interface MenuCaps {
	canMoveUp: boolean;
	canMoveDown: boolean;
}

const CONVERT: Array<{ action: MenuAction; label: string; kind: NodeKind }> = [
	{ action: 'convert-string', label: 'String', kind: 'string' },
	{ action: 'convert-number', label: 'Number', kind: 'number' },
	{ action: 'convert-boolean', label: 'Boolean', kind: 'bool' },
	{ action: 'convert-null', label: 'Null', kind: 'null' },
];

export function buildMenuModel(row: ContentRow, caps: MenuCaps): MenuGroup[] {
	const isObjectChild = typeof row.key === 'string' && row.depth > 0;
	const isInsideContainer = row.depth > 0;
	const isLeaf =
		row.kind === 'string' || row.kind === 'number' || row.kind === 'bool' || row.kind === 'null';
	const isObject = row.kind === 'object';

	const g: MenuGroup[] = [];

	const edit: MenuItem[] = [];
	if (isLeaf) edit.push({ type: 'action', action: 'edit-value', label: 'Edit value', ico: '✎' });
	if (isObjectChild) edit.push({ type: 'action', action: 'edit-key', label: 'Edit key', ico: '✎' });
	if (edit.length) g.push(edit);

	const clip: MenuItem[] = [
		{
			type: 'sub',
			label: 'Copy',
			ico: '⧉',
			children: [
				{ action: 'copy', label: 'Value' },
				{ action: 'copy-path', label: 'Path' },
			],
		},
	];
	if (isInsideContainer) {
		clip.push({ type: 'action', action: 'cut', label: 'Cut', ico: '✂' });
		clip.push({ type: 'action', action: 'paste', label: 'Paste as sibling', ico: '⇲' });
		clip.push({ type: 'action', action: 'duplicate', label: 'Duplicate', ico: '⎘' });
	}
	g.push(clip);

	const arrange: MenuItem[] = [];
	if (isInsideContainer) {
		arrange.push({
			type: 'sub',
			label: 'Insert',
			ico: '+',
			children: [
				{ action: 'insert-before', label: 'Before' },
				{ action: 'insert-after', label: 'After' },
			],
		});
		arrange.push({
			type: 'sub',
			label: 'Move',
			ico: '⇅',
			children: [
				{ action: 'move-up', label: 'Up', disabled: !caps.canMoveUp },
				{ action: 'move-down', label: 'Down', disabled: !caps.canMoveDown },
			],
		});
	}
	if (isObject) {
		arrange.push({
			type: 'sub',
			label: 'Sort keys',
			ico: '⇊',
			children: [
				{ action: 'sort-keys-asc', label: 'A→Z' },
				{ action: 'sort-keys-desc', label: 'Z→A' },
			],
		});
	}
	if (arrange.length) g.push(arrange);

	const convertChildren = CONVERT.filter((c) => c.kind !== row.kind).map((c) => ({
		action: c.action,
		label: c.label,
	}));
	if (convertChildren.length) {
		g.push([{ type: 'sub', label: 'Convert to', ico: '⇄', children: convertChildren }]);
	}

	g.push([{ type: 'action', action: 'extract', label: 'Extract to new tab', ico: '↗' }]);

	if (isInsideContainer) {
		g.push([{ type: 'action', action: 'remove', label: 'Remove', ico: '✕', danger: true }]);
	}

	return g;
}
