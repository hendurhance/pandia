import { docGetSlice, docGetValue } from '$lib/ipc/doc';
import { pathKey, type ContentRow, type Row } from './model';
import { reorderDestination } from '$lib/util/reorder';
import { pathToString } from '$lib/util/path';
import type { PromptController } from '$lib/ui/prompt.svelte';
import type { ApplyResult, DocHandle, Op, OpenSource, Path } from '$lib/ipc/types';

const CHUNK = 200;
const OBJECT_REORDER_MAX = 2000;

export interface CutMark {
	
	path: Path;
	
	text: string;
}

export interface NodeActionDeps {
	handle: () => DocHandle | null;
	rows: () => Row[];
	selectedIndex: () => number;
	setSelectedPath: (path: Path) => void;
	
	siblingCount: (parentPath: Path) => number | null;
	prompt: PromptController;
	
	apply: (op: Op) => Promise<ApplyResult | null>;
	setError: (msg: string) => void;
	flash: (msg: string) => void;
	onOpenInNewTab: (source: OpenSource) => void;
	
	getCutMark: () => CutMark | null;
	setCutMark: (mark: CutMark | null) => void;
}

export function createNodeActions(deps: NodeActionDeps) {
	
	async function fetchObjectKeys(path: Path): Promise<string[] | null> {
		const handle = deps.handle();
		if (!handle) return null;
		const keys: string[] = [];
		let start = 0;
		while (true) {
			const slice = await docGetSlice(handle, path, start, start + CHUNK);
			for (const nv of slice) {
				if (typeof nv.key === 'string') keys.push(nv.key);
			}
			if (slice.length < CHUNK) break;
			start += CHUNK;
			if (keys.length > OBJECT_REORDER_MAX) return null;
		}
		return keys;
	}

	
	async function copyValueJson(row: ContentRow): Promise<boolean> {
		const handle = deps.handle();
		if (!handle) return false;
		try {
			const value = await docGetValue(handle, row.path);
			const text =
				typeof value === 'string' ? value : JSON.stringify(value, null, 2);
			await navigator.clipboard.writeText(text);
			return true;
		} catch (e) {
			deps.setError(String(e));
			return false;
		}
	}

	function extractName(row: ContentRow): string {
		if (row.path.length === 0) return 'document.json';
		const last = row.key;
		const base = typeof last === 'number' ? `item-${last}` : String(last);
		return `${base}.json`;
	}

	async function remove(row: ContentRow) {
		if (row.depth === 0) return;
		const parentPath = row.path.slice(0, -1);
		if (typeof row.key === 'number') {
			await deps.apply({ kind: 'deleteItem', path: parentPath, index: row.key });
		} else {
			await deps.apply({ kind: 'deleteKey', path: parentPath, key: row.key });
		}
	}

	return {
		
		selectedContentRow(): ContentRow | null {
			const i = deps.selectedIndex();
			if (i < 0) return null;
			const r = deps.rows()[i];
			return r?.variant === 'content' ? r : null;
		},

		moveBounds(row: ContentRow): { up: boolean; down: boolean } {
			if (row.depth === 0) return { up: false, down: false };
			if (typeof row.key === 'number') {
				const count = deps.siblingCount(row.path.slice(0, -1));
				return { up: row.key > 0, down: count === null ? true : row.key < count - 1 };
			}
			return { up: true, down: true };
		},

		async insertSibling(row: ContentRow, where: 'before' | 'after') {
			const handle = deps.handle();
			if (row.depth === 0 || !handle) return;
			const parentPath = row.path.slice(0, -1);

			if (typeof row.key === 'number') {
				const targetIndex = where === 'before' ? row.key : row.key + 1;
				const valueText = await deps.prompt.show(`value at index ${targetIndex} (JSON):`, 'null');
				if (valueText === null) return;
				let value: unknown;
				try {
					value = JSON.parse(valueText);
				} catch (e) {
					deps.setError(`invalid JSON: ${(e as Error).message}`);
					return;
				}
				await deps.apply({ kind: 'insertItem', path: parentPath, index: targetIndex, value });
				return;
			}

			const newKey = await deps.prompt.show('new key:');
			if (newKey === null || newKey === '') return;
			const valueText = await deps.prompt.show(`value for "${newKey}" (JSON):`, 'null');
			if (valueText === null) return;
			let value: unknown;
			try {
				value = JSON.parse(valueText);
			} catch (e) {
				deps.setError(`invalid JSON: ${(e as Error).message}`);
				return;
			}

			const parentSlice = await docGetSlice(handle, parentPath, 0, CHUNK);
			const rowPosition = parentSlice.findIndex((nv) => nv.key === row.key);
			const targetPosition =
				rowPosition < 0 ? null : where === 'before' ? rowPosition : rowPosition + 1;

			await deps.apply({
				kind: 'insertKey',
				path: parentPath,
				key: newKey,
				value,
				position: targetPosition,
			});
		},

		async duplicate(row: ContentRow) {
			const handle = deps.handle();
			if (row.depth === 0 || !handle) return;
			const parentPath = row.path.slice(0, -1);
			const currentValue = await docGetValue(handle, row.path);

			if (typeof row.key === 'number') {
				await deps.apply({
					kind: 'insertItem',
					path: parentPath,
					index: row.key + 1,
					value: currentValue,
				});
				return;
			}

			const newKey = await deps.prompt.show('duplicate as new key:', `${row.key}_copy`);
			if (newKey === null || newKey === '') return;
			const parentSlice = await docGetSlice(handle, parentPath, 0, CHUNK);
			const rowPosition = parentSlice.findIndex((nv) => nv.key === row.key);
			const targetPosition = rowPosition < 0 ? null : rowPosition + 1;
			await deps.apply({
				kind: 'insertKey',
				path: parentPath,
				key: newKey,
				value: currentValue,
				position: targetPosition,
			});
		},

		remove,

		
		async move(row: ContentRow, dir: -1 | 1) {
			const handle = deps.handle();
			if (row.depth === 0 || !handle) return;
			const parentPath = row.path.slice(0, -1);

			if (typeof row.key === 'number') {
				const from = row.key;
				const to = from + dir;
				if (to < 0) return;
				const count = deps.siblingCount(parentPath);
				if (count !== null && to >= count) return;
				await deps.apply({ kind: 'moveItem', path: parentPath, from, to });
				deps.setSelectedPath([...parentPath, to]);
				return;
			}

			const keys = await fetchObjectKeys(parentPath);
			if (keys === null) {
				deps.setError(`object too large to reorder (> ${OBJECT_REORDER_MAX} keys)`);
				return;
			}
			const idx = keys.indexOf(row.key as string);
			const target = idx + dir;
			if (idx < 0 || target < 0 || target >= keys.length) return;
			const order = keys.slice();
			[order[idx], order[target]] = [order[target], order[idx]];
			await deps.apply({ kind: 'reorderKeys', path: parentPath, order });
		},

		
		async reorderTo(dragged: ContentRow, gap: number) {
			const handle = deps.handle();
			if (dragged.depth === 0 || !handle) return;
			const parentPath = dragged.path.slice(0, -1);

			if (typeof dragged.key === 'number') {
				const from = dragged.key;
				const to = reorderDestination(from, gap);
				if (to === null) return;
				await deps.apply({ kind: 'moveItem', path: parentPath, from, to });
				deps.setSelectedPath([...parentPath, to]);
				return;
			}

			const keys = await fetchObjectKeys(parentPath);
			if (keys === null) {
				deps.setError(`object too large to reorder (> ${OBJECT_REORDER_MAX} keys)`);
				return;
			}
			const from = keys.indexOf(dragged.key as string);
			if (from < 0) return;
			const to = reorderDestination(from, gap);
			if (to === null) return;
			const order = keys.slice();
			const [k] = order.splice(from, 1);
			order.splice(to, 0, k);
			await deps.apply({ kind: 'reorderKeys', path: parentPath, order });
		},

		
		async sortKeys(row: ContentRow, descending: boolean) {
			if (row.kind !== 'object' || !deps.handle()) return;
			await deps.apply({ kind: 'sortKeys', path: row.path, descending });
		},

		async copy(row: ContentRow) {
			if (await copyValueJson(row)) {
				deps.setCutMark(null);
				deps.flash('copied to clipboard');
			}
		},

		async copyPath(row: ContentRow) {
			try {
				await navigator.clipboard.writeText(pathToString(row.path));
				deps.setCutMark(null);
				deps.flash('copied path');
			} catch (e) {
				deps.setError(String(e));
			}
		},

		
		async cut(row: ContentRow) {
			if (row.depth === 0) return; // can't cut the root
			const handle = deps.handle();
			if (!handle) return;
			try {
				const value = await docGetValue(handle, row.path);
				const text = JSON.stringify(value, null, 2);
				await navigator.clipboard.writeText(text);
				deps.setCutMark({ path: row.path, text });
				deps.flash('cut — paste to move');
			} catch (e) {
				deps.setError(String(e));
			}
		},

		async paste(row: ContentRow) {
			const handle = deps.handle();
			if (row.depth === 0 || !handle) return;
			let text: string;
			try {
				text = await navigator.clipboard.readText();
			} catch {
				deps.setError('clipboard unavailable');
				return;
			}
			let value: unknown;
			try {
				value = JSON.parse(text);
			} catch {
				deps.setError('clipboard does not contain valid JSON');
				return;
			}
			const parentPath = row.path.slice(0, -1);

			const cut = deps.getCutMark();
			const isCutPaste =
				cut !== null &&
				cut.text === text &&
				pathKey(cut.path.slice(0, -1)) !== pathKey(parentPath);

			if (typeof row.key === 'number') {
				const inserted = await deps.apply({
					kind: 'insertItem',
					path: parentPath,
					index: row.key + 1,
					value,
				});
				if (!inserted) return;
			} else {
				const newKey = await deps.prompt.show('paste as new key:', `${row.key}_copy`);
				if (newKey === null || newKey === '') return;
				const parentSlice = await docGetSlice(handle, parentPath, 0, CHUNK);
				const rowPosition = parentSlice.findIndex((nv) => nv.key === row.key);
				const inserted = await deps.apply({
					kind: 'insertKey',
					path: parentPath,
					key: newKey,
					value,
					position: rowPosition < 0 ? null : rowPosition + 1,
				});
				if (!inserted) return;
			}

			if (isCutPaste && cut) {
				const sourceParent = cut.path.slice(0, -1);
				const sourceKey = cut.path[cut.path.length - 1];
				if (typeof sourceKey === 'number') {
					await deps.apply({
						kind: 'deleteItem',
						path: sourceParent,
						index: sourceKey,
					});
				} else {
					await deps.apply({
						kind: 'deleteKey',
						path: sourceParent,
						key: sourceKey,
					});
				}
			}
			deps.setCutMark(null);
		},

		async extract(row: ContentRow) {
			const handle = deps.handle();
			if (!handle) return;
			try {
				const value = await docGetValue(handle, row.path);
				deps.onOpenInNewTab({
					kind: 'text',
					text: JSON.stringify(value, null, 2),
					name: extractName(row),
				});
			} catch (e) {
				deps.setError(String(e));
			}
		},
	};
}
