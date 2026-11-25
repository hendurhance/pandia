// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { GridFilterController } from './grid-filters.svelte';

vi.mock('$lib/ipc/client', async () => ({ ipc: (await import('$lib/ipc/fake')).fakeIpc({}) }));

describe('removing an OR group before the active one', () => {
	it.each([
		['clearing its last column', (f: GridFilterController) => f.clearColumnIn(0, 'a')],
		['removing it', (f: GridFilterController) => f.removeGroup(0)],
	])('keeps the same group active after %s', (_, remove) => {
		const { result: f, destroy } = inRoot(
			() =>
				new GridFilterController({
					handle: () => 'h' as never,
					path: () => [],
					columns: () => [],
					onError: vi.fn(),
				}),
		);
		f.updateCol('a', { text: 'A' });
		f.addGroup();
		f.updateCol('b', { text: 'B' });
		f.addGroup();
		f.updateCol('c', { text: 'C' });
		f.setActiveGroup(1);

		remove(f);
		expect([...f.colFilters.keys()]).toEqual(['b']);
		destroy();
	});
});
