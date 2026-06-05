import { docGetSlice } from '$lib/ipc/doc';
import type { DocHandle, NodeKind, Path } from '$lib/ipc/types';
import { cardTitle, isContainerKind, pathId, type CardRow, type GraphCard } from './layout';
import { hueOf, toRow } from './card-helpers';

export const RENDER_CHILD_CAP = 5000;

export {
	NHUES,
	collapseTree,
	containerPreview,
	hueOf,
	scalarText,
	toRow,
} from './card-helpers';

export async function buildCard(
	handle: DocHandle,
	path: Path,
	kind: NodeKind,
): Promise<GraphCard> {
	const slice = await docGetSlice(handle, path, 0, RENDER_CHILD_CAP);
	return {
		id: pathId(path),
		path,
		title: cardTitle(path),
		kind,
		rows: slice.map((v) => toRow(path, v)),
		hue: hueOf(path),
	};
}

export async function expandRow(handle: DocHandle, row: CardRow): Promise<void> {
	if (!row.expandable || row.children.length > 0) return;
	if (row.valueKind === 'object') {
		row.children = [await buildCard(handle, row.childPath, 'object')];
		return;
	}
	const slice = await docGetSlice(handle, row.childPath, 0, RENDER_CHILD_CAP);
	const allContainers = slice.length > 0 && slice.every((v) => isContainerKind(v.kind));
	if (allContainers) {
		row.children = await Promise.all(
			slice.map((v) => buildCard(handle, [...row.childPath, v.key], v.kind)),
		);
	} else {
		row.children = [await buildCard(handle, row.childPath, 'array')];
	}
}
