// @vitest-environment jsdom
import { describe, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import HistoryPanel from './HistoryPanel.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docHistory: vi.fn() } }));

describe('HistoryPanel', () => {
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
