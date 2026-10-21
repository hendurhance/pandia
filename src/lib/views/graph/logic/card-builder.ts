import { ipc } from '$lib/ipc/client';
import type { DocHandle, NodeKind, Path } from '$lib/ipc/bindings';
import type { PathKey } from '$lib/views/tree/logic/model';
import {
	cardTitle,
	isContainerKind,
	pathId,
	type CardRow,
	type GraphCard,
	type MoreItems,
} from './layout';
import { hueOf, toRow } from './card-helpers';

export const RENDER_CHILD_CAP = 5000;
const PAGE = 100;

export { NHUES, collapseTree, containerPreview, hueOf, scalarText, toRow } from './card-helpers';

export async function buildCard(handle: DocHandle, path: Path, kind: NodeKind): Promise<GraphCard> {
	const slice = await ipc.docGetSlice(handle, path, 0, RENDER_CHILD_CAP);
	const rows = slice.map((v) => toRow(path, v));
	const total = slice.length < RENDER_CHILD_CAP ? 0 : await ipc.docChildCount(handle, path);
	if (total && total > slice.length) {
		rows.push({
			key: '…',
			value: `${(total - slice.length).toLocaleString()} more`,
			valueKind: 'null',
			colorHex: null,
			container: false,
			expandable: false,
			childPath: [...path, slice.length],
			children: [],
		});
	}
	return { id: pathId(path), path, title: cardTitle(path), kind, rows, hue: hueOf(path) };
}

export async function expandRow(
	handle: DocHandle,
	row: CardRow,
	maxCards = PAGE + 1,
): Promise<void> {
	if (!row.expandable || row.children.length > 0) return;
	if (row.valueKind === 'object') {
		row.children = [await buildCard(handle, row.childPath, 'object')];
		return;
	}
	const slice = await ipc.docGetSlice(handle, row.childPath, 0, RENDER_CHILD_CAP);
	const allContainers = slice.length > 0 && slice.every((v) => isContainerKind(v.kind));
	if (allContainers) {
		const total = (await ipc.docChildCount(handle, row.childPath)) ?? slice.length;
		row.children = await itemCards(handle, { row, total }, 0, maxCards);
	} else {
		row.children = [await buildCard(handle, row.childPath, 'array')];
	}
}

export type OpenRows = Map<PathKey, { cards: number; length: number | null }>;

function itemCount(row: CardRow): number | null {
	const first = row.children[0];
	if (!first || first.path.length === row.childPath.length) return null;
	return row.children.at(-1)?.more?.total ?? row.children.length;
}

export function openRows(card: GraphCard, out: OpenRows = new Map()): OpenRows {
	for (const r of card.rows) {
		if (r.children.length > 0) {
			out.set(pathId(r.childPath), { cards: r.children.length, length: itemCount(r) });
		}
		for (const ch of r.children) openRows(ch, out);
	}
	return out;
}

export async function reopenRows(
	handle: DocHandle,
	card: GraphCard,
	open: OpenRows,
): Promise<void> {
	const rows = card.rows.filter((r) => open.has(pathId(r.childPath)));
	await Promise.all(rows.map((r) => expandRow(handle, r, open.get(pathId(r.childPath))?.cards)));
	const steady = rows.filter((r) => itemCount(r) === open.get(pathId(r.childPath))?.length);
	await Promise.all(steady.flatMap((r) => r.children.map((ch) => reopenRows(handle, ch, open))));
}

export async function showMore(handle: DocHandle, more: MoreItems): Promise<void> {
	const { row } = more;
	const page = await itemCards(handle, more, row.children.length - 1, PAGE + 1);
	if (row.children.at(-1)?.more !== more) return;
	row.children = [...row.children.slice(0, -1), ...page];
}

async function itemCards(
	handle: DocHandle,
	{ row, total }: MoreItems,
	start: number,
	maxCards: number,
): Promise<GraphCard[]> {
	const end = total - start <= maxCards ? total : start + maxCards - 1;
	const slice = await ipc.docGetSlice(handle, row.childPath, start, end);
	const cards = await Promise.all(
		slice.map((v) => buildCard(handle, [...row.childPath, v.key], v.kind)),
	);
	if (end < total) {
		const path = [...row.childPath, end];
		cards.push({
			id: pathId(path),
			path,
			title: `… ${(total - end).toLocaleString()} more`,
			kind: 'array',
			rows: [],
			hue: hueOf(path),
			more: { row, total },
		});
	}
	return cards;
}
