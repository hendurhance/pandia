// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { NodeView } from '$lib/ipc/bindings';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import OutlinePanel from './OutlinePanel.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({ docGetSlice: vi.fn() }),
}));

afterEach(() => cleanup());

const ctx = (handle: string, version = 1) => ({ handle, version }) as unknown as DocContext;

const keys = (prefix: string, count: number, from = 0): NodeView[] =>
	Array.from({ length: count }, (_, i) => ({
		key: `${prefix}${from + i}`,
		kind: 'string',
		preview: '"x"',
		childCount: null,
	}));

// jsdom has no ResizeObserver; the outline's scroller only needs observe/disconnect.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

describe('OutlinePanel', () => {
	it('shows the document again after visiting an empty tab and coming back', async () => {
		vi.mocked(ipc.docGetSlice).mockResolvedValue([
			{ key: 'name', kind: 'string', preview: '"x"', childCount: null },
		]);
		const context = { handle: 'h1', version: 3 } as unknown as DocContext;
		const { findByText, rerender } = render(OutlinePanel, { props: { context } });
		await findByText('document');

		await rerender({ context: null });
		await rerender({ context });
		await findByText('document');
	});

	it('keeps expanded nodes open after an edit', async () => {
		vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) =>
			path.length === 0
				? [{ key: 'users', kind: 'object', preview: '{…}', childCount: 1 }]
				: [{ key: 'ada', kind: 'string', preview: '"x"', childCount: null }],
		);
		const { findByText, rerender } = render(OutlinePanel, {
			props: { context: { handle: 'h1', version: 1 } as unknown as DocContext },
		});
		await fireEvent.click(await findByText('users'));
		await findByText('ada');

		await rerender({ context: { handle: 'h1', version: 2 } as unknown as DocContext });
		await vi.waitFor(() => expect(vi.mocked(ipc.docGetSlice).mock.calls.length).toBeGreaterThan(2));
		await new Promise((r) => setTimeout(r, 0));
		await findByText('ada');
	});

	it('keeps the tree and shows the error when one expand fails', async () => {
		vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) => {
			if (path.length > 0) throw new Error('engine went away');
			return [{ key: 'users', kind: 'object', preview: '{…}', childCount: 1 }, ...keys('k', 1)];
		});
		const { findByText, queryByText } = render(OutlinePanel, { props: { context: ctx('A') } });
		await fireEvent.click(await findByText('users'));
		await findByText(/engine went away/);
		expect(queryByText('k0')).not.toBeNull();
	});
});

describe('OutlinePanel — switching tabs', () => {
	it("drops the previous tab's rows while the next tab loads", async () => {
		vi.mocked(ipc.docGetSlice).mockImplementation((h) =>
			h === 'A' ? Promise.resolve(keys('a', 1)) : new Promise(() => {}),
		);
		const { findByText, queryByText, rerender } = render(OutlinePanel, {
			props: { context: ctx('A') },
		});
		await findByText('a0');
		await rerender({ context: ctx('B') });
		expect(queryByText('a0')).toBeNull();
	});

	it('does not add a late "load more" from the previous tab to the next one', async () => {
		let finishMore: (rows: NodeView[]) => void = () => {};
		vi.mocked(ipc.docGetSlice).mockImplementation((h, _p, start) => {
			if (h === 'B') return Promise.resolve(keys('b', 1));
			if (start === 0) return Promise.resolve(keys('a', 200));
			return new Promise((r) => (finishMore = r));
		});
		const { container, findByText, rerender } = render(OutlinePanel, {
			props: { context: ctx('A') },
		});
		await findByText('a0');
		const scroller = container.querySelector<HTMLElement>('.scroller')!;
		scroller.scrollTop = 200 * 24;
		scroller.dispatchEvent(new Event('scroll'));
		await fireEvent.click(await findByText('Load 200 more…'));

		await rerender({ context: ctx('B') });
		const count = () => container.querySelector('.section-count')?.textContent;
		await vi.waitFor(() => expect(count()).toBe('1'));
		finishMore(keys('a', 200, 200));
		await new Promise((r) => setTimeout(r, 0));
		expect(count()).toBe('1');
	});
});
