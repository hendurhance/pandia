import type { NodeKind, NodeView, Path } from '$lib/ipc/types';
import { hexColorOf, isContainerKind, rowKeyLabel, type CardRow, type GraphCard } from './layout';

export const NHUES = 4;

export function containerPreview(kind: NodeKind, n: number | null): string {
	if (kind === 'array')
		return n === 0 ? '[]' : n === null ? '[…]' : `[${n} item${n === 1 ? '' : 's'}]`;
	return n === 0 ? '{}' : n === null ? '{…}' : `{${n} key${n === 1 ? '' : 's'}}`;
}

export function scalarText(v: NodeView): string {
	if (v.kind !== 'string') return v.preview;
	let s = v.preview;
	if (s.startsWith('"')) s = s.slice(1);
	if (s.endsWith('"')) s = s.slice(0, -1);
	return s;
}

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

export function hueOf(path: Path): number {
	if (path.length === 0) return hash('root') % NHUES;
	const last = path[path.length - 1];
	const base = typeof last === 'number' ? String(path[path.length - 2] ?? 'item') : String(last);
	return hash(base) % NHUES;
}

export function toRow(parentPath: Path, v: NodeView): CardRow {
	const childPath = [...parentPath, v.key];
	const container = isContainerKind(v.kind);
	const expandable = container && (v.childCount ?? 0) > 0;
	const value = container ? containerPreview(v.kind, v.childCount) : scalarText(v);
	return {
		key: rowKeyLabel(v.key),
		value,
		valueKind: v.kind,
		colorHex: container ? null : hexColorOf(v.kind, value),
		container,
		expandable,
		childPath,
		children: [],
	};
}

export function collapseTree(card: GraphCard): void {
	for (const r of card.rows) {
		for (const ch of r.children) collapseTree(ch);
		r.children = [];
	}
}
