// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { SMALL_TIER } from '$lib/ipc/fake';
import type { Capabilities } from '$lib/ipc/bindings';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import TypegenPanel from './TypegenPanel.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({ docGenerateTypes: vi.fn() }),
}));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

function ctx(handle: string, capabilities: Capabilities = SMALL_TIER.capabilities): DocContext {
	return { handle, version: 1, sourceName: null, capabilities } as unknown as DocContext;
}

describe('TypegenPanel', () => {
	it("hides the last tab's types while it generates for a new tab", async () => {
		vi.mocked(ipc.docGenerateTypes)
			.mockResolvedValueOnce('type Small = {}')
			.mockReturnValueOnce(new Promise(() => {}));
		const { findByText, rerender } = render(TypegenPanel, { props: { context: ctx('small') } });
		await findByText('type Small = {}');

		await rerender({ context: ctx('big') });
		await findByText('Generating TypeScript…');
	});

	it('says why a file read straight from disk has no types, and asks for none', async () => {
		vi.mocked(ipc.docGenerateTypes).mockClear();
		const capabilities = { ...SMALL_TIER.capabilities, typegen: false };
		const { findByText } = render(TypegenPanel, { props: { context: ctx('huge', capabilities) } });
		await findByText('Type generation is off for files over 2.00 GiB.');
		expect(ipc.docGenerateTypes).not.toHaveBeenCalled();
	});
});
