import { describe, it, expect, vi } from 'vitest';
import { recentsStore } from './recents-store.svelte';

vi.mock('$lib/util/persist', () => ({
	RECENTS_FILE: 'recents.json',
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

describe('recent files', () => {
	it('keeps every pinned file and caps the unpinned ones at fifty', () => {
		recentsStore.add('/pinned.json');
		recentsStore.togglePin('/pinned.json');
		for (let i = 0; i < 60; i++) recentsStore.add(`/file-${i}.json`);

		const paths = recentsStore.list.map((e) => e.path);
		expect(paths).toContain('/pinned.json');
		expect(paths).toHaveLength(51);
		expect(paths[0]).toBe('/file-59.json');
	});
});
