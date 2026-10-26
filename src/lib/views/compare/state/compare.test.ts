import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import type { OpenOutcome } from '$lib/ipc/bindings';
import { CompareController, type CompareDeps } from './compare.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => true),
	},
}));

function opened(handle: string): OpenOutcome {
	return {
		kind: 'opened',
		handle: handle as never,
		summary: { version: 0, sourceSize: 1 } as never,
		notes: { convertedFrom: null, repairs: [] },
	};
}

async function comparingWith(path: string, handle: string) {
	const compare = new CompareController({
		mainHandle: () => 'main' as never,
		flushEdits: async () => true,
		setViewMode: () => {},
		setBusy: () => {},
		setError: () => {},
		isHandleAlive: () => true,
	} as CompareDeps);
	vi.mocked(ipc.docOpen).mockResolvedValueOnce(opened(handle));
	await compare.openFile(path);
	return compare;
}

describe('CompareController — replacing the compare target', () => {
	beforeEach(() => vi.clearAllMocks());

	it('keeps the current compare open when the new target fails to open', async () => {
		const compare = await comparingWith('/w/old.json', 'old');

		vi.mocked(ipc.docOpen).mockResolvedValueOnce({
			kind: 'failed',
			detail: 'missing',
			tooLargeToFix: false,
			diagnosis: null,
		} as never);
		await compare.openFile('/w/missing.json');
		vi.mocked(ipc.docSummary).mockRejectedValueOnce(new Error('tab closed'));
		await compare.start({ kind: 'tab', handle: 'gone' as never, sourceName: 'b.json' });

		expect(ipc.docClose).not.toHaveBeenCalled();
		expect(compare.handle).toBe('old');
		expect(compare.sourceName).toBe('/w/old.json');
	});

	it('closes the old file once the new target is open', async () => {
		const compare = await comparingWith('/w/old.json', 'old');
		vi.mocked(ipc.docOpen).mockResolvedValueOnce(opened('new'));
		await compare.openFile('/w/new.json');

		expect(ipc.docClose).toHaveBeenCalledWith('old');
		expect(compare.handle).toBe('new');
	});
});
