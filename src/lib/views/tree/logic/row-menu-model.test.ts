import { describe, it, expect } from 'vitest';
import { buildMenuModel } from './row-menu-model';
import type { ContentRow, MenuAction } from './model';

function row(over: Partial<ContentRow>): ContentRow {
	return {
		variant: 'content',
		path: [],
		depth: 1,
		key: 'k',
		kind: 'string',
		preview: '""',
		childCount: null,
		sizeHint: 0,
		expanded: false,
		...over,
	};
}

const caps = { canMoveUp: true, canMoveDown: true };

function actions(groups: ReturnType<typeof buildMenuModel>): MenuAction[] {
	const out: MenuAction[] = [];
	for (const group of groups) {
		for (const item of group) {
			if (item.type === 'action') out.push(item.action);
			else for (const c of item.children) out.push(c.action);
		}
	}
	return out;
}

describe('buildMenuModel', () => {
	it('a string object-child: edit value + key, convert away from string, removable', () => {
		const a = actions(buildMenuModel(row({ kind: 'string', key: 'name', depth: 1 }), caps));
		expect(a).toContain('edit-value');
		expect(a).toContain('edit-key');
		expect(a).toContain('remove');
		expect(a).toContain('cut');
		expect(a).toContain('convert-number');
		expect(a).not.toContain('convert-string'); // current kind is hidden
	});

	it('an array element (numeric key) offers no edit-key', () => {
		const a = actions(buildMenuModel(row({ kind: 'number', key: 0, depth: 1 }), caps));
		expect(a).toContain('edit-value');
		expect(a).not.toContain('edit-key');
		expect(a).not.toContain('convert-number');
	});

	it('the root object: not removable/cuttable, no edit, but sortable + copyable + extractable', () => {
		const a = actions(
			buildMenuModel(row({ kind: 'object', key: '$', depth: 0, childCount: 3 }), caps),
		);
		expect(a).not.toContain('remove');
		expect(a).not.toContain('cut');
		expect(a).not.toContain('edit-value');
		expect(a).not.toContain('edit-key');
		expect(a).toContain('sort-keys-asc');
		expect(a).toContain('sort-keys-desc');
		expect(a).toContain('copy-path');
		expect(a).toContain('extract');
	});

	it('move children reflect the caps via `disabled`', () => {
		const groups = buildMenuModel(row({ kind: 'string', key: 'name', depth: 1 }), {
			canMoveUp: false,
			canMoveDown: true,
		});
		const move = groups.flat().find((it) => it.type === 'sub' && it.label === 'Move');
		expect(move && move.type === 'sub').toBe(true);
		if (move && move.type === 'sub') {
			expect(move.children.find((c) => c.action === 'move-up')?.disabled).toBe(true);
			expect(move.children.find((c) => c.action === 'move-down')?.disabled).toBe(false);
		}
	});

	it('groups are non-empty (no dangling dividers)', () => {
		const groups = buildMenuModel(row({ kind: 'string', key: 'name', depth: 1 }), caps);
		expect(groups.every((g) => g.length > 0)).toBe(true);
	});
});
