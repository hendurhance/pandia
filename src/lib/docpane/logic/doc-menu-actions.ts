import type { ApplyResult, Op } from '$lib/ipc/types';
import type { ContentRow, MenuAction } from '$lib/views/tree/logic/model';
import type { createNodeActions } from '$lib/views/tree/logic/node-actions';
import type { DocEditController } from '../state/doc-edit.svelte';
import { assertNever } from '$lib/util/guards';

export interface DocMenuDeps {
	edit: DocEditController;
	nodeActions: ReturnType<typeof createNodeActions>;
	apply: (op: Op) => Promise<ApplyResult | null>;
}

export function createDocMenuActions(deps: DocMenuDeps) {
	const { edit, nodeActions, apply } = deps;
	return async (action: MenuAction, rowIndex: number, row: ContentRow) => {
		switch (action) {
			case 'edit-key':
				edit.startKey(rowIndex);
				break;
			case 'edit-value':
				void edit.startValue(rowIndex);
				break;
			case 'copy':
				await nodeActions.copy(row);
				break;
			case 'copy-path':
				await nodeActions.copyPath(row);
				break;
			case 'cut':
				await nodeActions.cut(row);
				break;
			case 'paste':
				await nodeActions.paste(row);
				break;
			case 'extract':
				await nodeActions.extract(row);
				break;
			case 'insert-before':
				await nodeActions.insertSibling(row, 'before');
				break;
			case 'insert-after':
				await nodeActions.insertSibling(row, 'after');
				break;
			case 'duplicate':
				await nodeActions.duplicate(row);
				break;
			case 'move-up':
				await nodeActions.move(row, -1);
				break;
			case 'move-down':
				await nodeActions.move(row, 1);
				break;
			case 'sort-keys-asc':
				await nodeActions.sortKeys(row, false);
				break;
			case 'sort-keys-desc':
				await nodeActions.sortKeys(row, true);
				break;
			case 'remove':
				await nodeActions.remove(row);
				break;
			case 'convert-string':
				await apply({ kind: 'setValue', path: row.path, value: '' });
				break;
			case 'convert-number':
				await apply({ kind: 'setValue', path: row.path, value: 0 });
				break;
			case 'convert-boolean':
				await apply({ kind: 'setValue', path: row.path, value: false });
				break;
			case 'convert-null':
				await apply({ kind: 'setValue', path: row.path, value: null });
				break;
			default:
				assertNever(action);
		}
	};
}
