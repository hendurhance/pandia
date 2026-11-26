import { describe, it, expect, vi } from 'vitest';
import type { Row } from '../../views/tree/logic/model';
import { collapseAll } from './bulk-tree-ops';

describe('collapseAll', () => {
	it('keeps the real value of a scalar root', async () => {
		let rows: Row[] = [
			{
				variant: 'content',
				path: [],
				depth: 0,
				key: '$',
				kind: 'string',
				preview: '"hello"',
				childCount: null,
				expanded: false,
			},
		];
		const selectPath = vi.fn();
		await collapseAll({
			tree: { setRows: (r) => (rows = r), toggleAt: vi.fn() },
			summary: { rootKind: 'string', rootChildCount: null },
			selectPath,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ preview: '"hello"' });
		expect(selectPath).toHaveBeenCalledWith([]);
	});
});
