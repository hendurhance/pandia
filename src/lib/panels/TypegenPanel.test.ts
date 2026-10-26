// @vitest-environment jsdom
import { describe, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import TypegenPanel from './TypegenPanel.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGenerateTypes: vi.fn() } }));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

function ctx(handle: string): DocContext {
	return { handle, version: 1, sourceName: null } as unknown as DocContext;
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
});
