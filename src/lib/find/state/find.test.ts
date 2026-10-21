import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { FindController, type FindDeps } from './find.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: { docSearch: vi.fn(async () => []), cancelJob: vi.fn(async () => true) },
}));

function controller(handle: string | null = null) {
	return new FindController({
		handle: () => handle,
		canOpen: () => true,
		isCodeView: () => false,
		isGraphView: () => false,
		switchToTree: () => {},
		codeApi: () => null,
		openGraphSearch: () => {},
		navigateToHit: () => {},
		afterReplace: async () => {},
	} as FindDeps);
}

describe('FindController — find and replace', () => {
	it('Find leaves the replace field as it was', () => {
		const find = controller();
		find.openFind();
		expect(find.open).toBe(true);
		expect(find.replaceOpen).toBe(false);
	});

	it('Find and Replace opens the bar with the replace field showing', () => {
		const find = controller();
		find.openReplace();
		expect(find.open).toBe(true);
		expect(find.replaceOpen).toBe(true);
	});
});

describe('FindController — the typing debounce', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		['closing the bar', (find: FindController) => find.close()],
		['switching document', (find: FindController) => find.reset()],
	])('%s before the debounce ends cancels the search', async (_, stop) => {
		vi.useFakeTimers();
		try {
			const find = controller('h');
			find.openFind();
			find.onQueryChange('name');
			stop(find);
			await vi.runAllTimersAsync();
			expect(ipc.docSearch).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
