import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import type { OpenOutcome } from '$lib/ipc/bindings';
import { SMALL_TIER } from '$lib/ipc/fake';
import { CompareController, type CompareDeps } from './compare.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => true),
	}),
}));

function opened(handle: string, compare = true): OpenOutcome {
	return {
		kind: 'opened',
		handle: handle as never,
		summary: {
			version: 0,
			sourceSize: 5 * 1024 ** 3,
			capabilities: { ...SMALL_TIER.capabilities, compare },
		} as never,
		notes: { convertedFrom: null, repairs: [] },
	};
}

async function comparingWith(path: string, handle: string, setError = vi.fn()) {
	const compare = new CompareController({
		mainHandle: () => 'main' as never,
		mainSummary: () => null,
		flushEdits: async () => true,
		setViewMode: () => {},
		setBusy: () => {},
		setError,
		isHandleAlive: () => true,
	} as CompareDeps);
	vi.mocked(ipc.docOpen).mockResolvedValueOnce(opened(handle));
	await compare.openFile(path);
	return compare;
}

describe('CompareController — replacing the compare target', () => {
	beforeEach(() => vi.clearAllMocks());

	it('refuses a file too big to compare, closes it and keeps the current compare', async () => {
		const setError = vi.fn();
		const compare = await comparingWith('/w/old.json', 'old', setError);
		vi.mocked(ipc.docOpen).mockResolvedValueOnce(opened('huge', false));

		await compare.openFile('/w/huge.json');

		expect(ipc.docClose).toHaveBeenCalledWith('huge');
		expect(compare.handle).toBe('old');
		expect(setError).toHaveBeenLastCalledWith(
			'huge.json is 5.00 GiB. Compare works on files up to 200.0 MiB.',
		);
	});

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
