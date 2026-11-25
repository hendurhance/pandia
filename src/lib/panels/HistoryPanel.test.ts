// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import HistoryPanel from './HistoryPanel.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({ docHistory: vi.fn() }),
}));

afterEach(() => cleanup());

describe('HistoryPanel', () => {
	it("drops the previous tab's edits while the next tab loads", async () => {
		vi.mocked(ipc.docHistory).mockImplementation((h) =>
			h === 'A'
				? Promise.resolve({
						undo: [{ label: 'edit in A', pathDisplay: '$.a' }],
						redo: [],
						cap: 100,
					})
				: new Promise(() => {}),
		);
		const ctx = (handle: string) => ({ handle, version: 1 }) as unknown as DocContext;
		const { findByText, queryByText, rerender } = render(HistoryPanel, {
			props: { context: ctx('A') },
		});
		await findByText('edit in A');
		await rerender({ context: ctx('B') });
		expect(queryByText('edit in A')).toBeNull();
	});

	it('shows the edits again after visiting an empty tab and coming back', async () => {
		vi.mocked(ipc.docHistory).mockResolvedValue({
			undo: [{ label: 'set value', pathDisplay: '$.a' }],
			redo: [],
			cap: 100,
		});
		const context = { handle: 'h1', version: 3 } as unknown as DocContext;
		const { findByText, rerender } = render(HistoryPanel, { props: { context } });
		await findByText('set value');

		await rerender({ context: null });
		await rerender({ context });
		await findByText('set value');
	});
});
