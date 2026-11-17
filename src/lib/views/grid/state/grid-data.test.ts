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

function controller(rowCount: number, filtering: boolean, quick = () => '') {
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
					quick: quick(),
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

	it("reads only an object row's own keys", async () => {
		vi.mocked(ipc.docGetRows).mockResolvedValue([
			asLosslessText('{"a": 1}'),
			asLosslessText('[1, 2]'),
			asLosslessText('12345678901234567890'),
			asLosslessText('{"constructor": 5}'),
		]);
		const { result: data, destroy } = controller(4, false);
		await data.fetchRange(0, 3);
		for (const key of ['constructor', 'toString', 'valueOf', '__proto__']) {
			expect(data.getCell(0, key)).toBe(MISSING);
		}
		expect(data.getCell(1, 'length')).toBe(MISSING);
		expect(data.getCell(2, 'value')).toBe(MISSING);
		expect(data.getCell(3, 'constructor')).toBe(5);
		expect(data.loadedColumnTexts('constructor')).toEqual(['5']);
		expect(data.loadedColumnTexts('length')).toEqual([]);
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

	it('keeps the last total while the same query reloads, and drops it for a new query', async () => {
		vi.mocked(ipc.docGetRowsFiltered).mockResolvedValue({ rows: [], total: 600 });
		let quick = 'x';
		const { result: data, destroy } = controller(1000, true, () => quick);
		data.reset();
		await data.fetchRange(0, 1);
		expect(data.effectiveRowCount).toBe(600);

		data.reset();
		expect(data.effectiveRowCount).toBe(600);
		quick = 'y';
		data.reset();
		expect(data.effectiveRowCount).toBe(0);
		destroy();
	});
});
