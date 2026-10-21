// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { asLosslessText } from '$lib/ipc/wire';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { MISSING } from '../logic/grid-cell';
import { GridDataController } from './grid-data.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: { docGetRows: vi.fn(), docGetRowsFiltered: vi.fn(), cancelJob: vi.fn(async () => true) },
}));

function controller(rowCount: number, filtering: boolean) {
	return inRoot(
		() =>
			new GridDataController({
				handle: () => 'doc',
				path: () => [],
				rowCount: () => rowCount,
				query: () => ({
					sortKey: null,
					sortDesc: false,
					filterGroups: [],
					quick: '',
					quickKeys: [],
					filtering,
				}),
				onFilterOverflow: () => {},
				onError: () => {},
			}),
	);
}

describe('GridDataController.getCell', () => {
	it('keeps an explicit null distinct from an absent key', async () => {
		vi.mocked(ipc.docGetRows).mockResolvedValue([
			asLosslessText('{"score": null}'),
			asLosslessText('{}'),
		]);
		const { result: data, destroy } = controller(2, false);
		await data.fetchRange(0, 1);
		expect(data.getCell(0, 'score')).toBeNull();
		expect(data.getCell(1, 'score')).toBe(MISSING);
		destroy();
	});
});

describe('GridDataController filtered fetches', () => {
	it('cancels every page still loading when the filter resets', () => {
		vi.mocked(ipc.docGetRowsFiltered).mockImplementation(() => new Promise(() => {}));
		const { result: data, destroy } = controller(1000, true);
		void data.fetchRange(90, 110); // straddles the page boundary at 100
		const ids = vi.mocked(ipc.docGetRowsFiltered).mock.calls.map(([, , , , , id]) => id);
		expect(new Set(ids).size).toBe(2);

		data.reset();
		expect(vi.mocked(ipc.cancelJob).mock.calls).toEqual(ids.map((id) => [id]));
		destroy();
	});
});
