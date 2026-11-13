// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { GridDataController, type GridQuery } from './grid-data.svelte';
import { GridSelectionController } from './grid-select.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docGetRows: vi.fn(),
		docGetRowIndices: vi.fn(() => new Promise(() => {})),
		cancelJob: vi.fn(async () => true),
	},
}));

function selectionOver(query: Partial<GridQuery> = {}) {
	return inRoot(() => {
		const data = new GridDataController({
			handle: () => 'doc',
			path: () => [],
			rowCount: () => 1_000_001,
			query: () => ({
				sortKey: null,
				sortDesc: false,
				filterGroups: [],
				quick: '',
				quickKeys: [],
				filtering: false,
				...query,
			}),
			onFilterOverflow: () => {},
			onError: () => {},
		});
		return new GridSelectionController({
			data,
			handle: () => 'doc',
			path: () => [],
			onExtract: () => {},
			onOpenInTree: () => {},
			onError: () => {},
		});
	});
}

describe('GridSelectionController.onIndexClick', () => {
	beforeEach(() => vi.clearAllMocks());

	it('shift-click from row 0 to row 1,000,000 does not start a page fetch per 100 rows', () => {
		vi.mocked(ipc.docGetRows).mockReturnValue(new Promise(() => {}));
		const { result: selection, destroy } = selectionOver();
		selection.onIndexClick(new MouseEvent('click'), 0, 0);
		selection.onIndexClick(new MouseEvent('click', { shiftKey: true }), 1_000_000, 1_000_000);
		const started = vi.mocked(ipc.docGetRows).mock.calls.length;
		destroy();
		expect(started).toBeLessThanOrEqual(1);
	});

	it('shift-click selects the rows the engine lists for the range under the current query', async () => {
		vi.mocked(ipc.docGetRowIndices).mockResolvedValueOnce([7, 3, 9]);
		const { result: selection, destroy } = selectionOver({
			sortKey: 'v',
			sortDesc: true,
			quick: ' ab ',
			quickKeys: ['name'],
			filtering: true,
		});
		selection.onIndexClick(new MouseEvent('click'), 0, 7);
		selection.onIndexClick(new MouseEvent('click', { shiftKey: true }), 2, 9);
		await vi.waitFor(() => expect([...selection.selectedRows]).toEqual([7, 3, 9]));
		expect(ipc.docGetRowIndices).toHaveBeenCalledExactlyOnceWith('doc', [], 0, 3, {
			groups: [],
			quick: 'ab',
			quickKeys: ['name'],
			sortKey: 'v',
			descending: true,
		});
		destroy();
	});

	it('drops a range that arrives after the grid resets', async () => {
		let arrive: (indices: number[]) => void = () => {};
		vi.mocked(ipc.docGetRowIndices).mockReturnValueOnce(new Promise((r) => (arrive = r)));
		const { result: selection, destroy } = selectionOver();
		selection.onIndexClick(new MouseEvent('click'), 0, 0);
		selection.onIndexClick(new MouseEvent('click', { shiftKey: true }), 2, 2);
		selection.reset();
		arrive([0, 1, 2]);
		await new Promise((r) => setTimeout(r, 0));
		expect(selection.selectedRows.size).toBe(0);
		destroy();
	});
});
