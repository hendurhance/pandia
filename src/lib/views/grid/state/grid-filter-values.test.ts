// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { asLosslessText } from '$lib/ipc/wire';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { GridFilterController } from './grid-filters.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docColumnValues: vi.fn() } }));

const click = () =>
	({
		stopPropagation() {},
		currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) },
	}) as unknown as MouseEvent;

describe('a column checklist that was loading when the document changed', () => {
	it('lists the values of the changed document', async () => {
		let release!: () => void;
		vi.mocked(ipc.docColumnValues).mockImplementationOnce(async () => {
			await new Promise<void>((r) => (release = r));
			return { capped: false, values: [{ value: asLosslessText('"old"'), count: 1 }] };
		});
		vi.mocked(ipc.docColumnValues).mockResolvedValue({
			capped: false,
			values: [{ value: asLosslessText('"new"'), count: 1 }],
		});
		const { result: filter, destroy } = inRoot(
			() =>
				new GridFilterController({
					handle: () => 'h' as never,
					path: () => [],
					columns: () => [],
					onError: vi.fn(),
				}),
		);

		filter.openFilter(click(), 'status');
		filter.resetValues();
		release();
		await new Promise((r) => setTimeout(r, 0));

		filter.openFilter(click(), 'status');
		await new Promise((r) => setTimeout(r, 0));
		expect(filter.openValues?.values.map((v) => v.value)).toEqual(['new']);
		destroy();
	});
});
