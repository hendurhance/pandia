// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CompareTree from './CompareTree.svelte';

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docSummary: vi.fn(async () => ({ rootKind: 'string', rootChildCount: null })),
		docGetValue: vi.fn(async () => '"hello"'),
	},
}));

describe('CompareTree', () => {
	it('shows the real value of a scalar root', async () => {
		const { container } = render(CompareTree, {
			props: { handle: 'L' as never, version: 1, diff: new Map() },
		});
		await vi.waitFor(() => expect(container.textContent).toContain('"hello"'));
		expect(container.textContent).not.toContain('{…}');
	});
});
