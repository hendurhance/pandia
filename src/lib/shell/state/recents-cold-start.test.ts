import { describe, expect, it, vi } from 'vitest';
import { loadPersisted, savePersisted } from '$lib/util/persist';
import { addRecent, recentsStore } from './recents-store.svelte';

vi.mock('$lib/util/persist', () => ({
	RECENTS_FILE: 'pandia-recents.json',
	loadPersisted: vi.fn(),
	savePersisted: vi.fn(async () => {}),
}));

describe('recent files at a cold start', () => {
	it('keeps the saved list when a file opens before the list has loaded', async () => {
		const saved = [
			{
				path: '/w/pinned.json',
				name: 'pinned.json',
				openedAt: '2026-01-01T00:00:00Z',
				pinned: true,
			},
			{ path: '/w/old.json', name: 'old.json', openedAt: '2026-01-02T00:00:00Z' },
		];
		let listArrives!: (v: unknown) => void;
		vi.mocked(loadPersisted).mockImplementation(() => new Promise((r) => (listArrives = r)));

		const loading = recentsStore.init();
		addRecent('/w/new.json');
		listArrives(saved);
		await loading;

		expect(recentsStore.list.map((r) => r.path)).toEqual([
			'/w/new.json',
			'/w/pinned.json',
			'/w/old.json',
		]);
		const written = vi.mocked(savePersisted).mock.calls.at(-1)?.[2] as { path: string }[];
		expect(written.map((r) => r.path)).toContain('/w/pinned.json');
	});
});
