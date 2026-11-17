// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { NodeView, Path } from '$lib/ipc/bindings';
import { reactiveBox } from '$lib/views/shared/test-runes.svelte';
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
		docGetSlice: vi.fn(),
		docChildCount: vi.fn(),
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

	it('scrolls to the newest target when an older one finishes loading last', async () => {
		vi.mocked(ipc.docSummary).mockResolvedValue({ rootKind: 'object', rootChildCount: 2 } as never);
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const slices: Record<string, NodeView[]> = {
			'[]': [
				{ key: 'b', kind: 'number', preview: '1', childCount: null },
				{ key: 'a', kind: 'object', preview: '{…}', childCount: 1 },
			],
			'["a"]': [{ key: 'x', kind: 'number', preview: '1', childCount: null }],
		};
		vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path) => {
			if (path.length > 0) await gate;
			return slices[JSON.stringify(path)] ?? [];
		});
		const scrolls: number[] = [];
		const active = reactiveBox<Path>(['a', 'x']);
		render(CompareTree, {
			props: {
				handle: 'L' as never,
				version: 1,
				diff: new Map(),
				get activePath() {
					return active.value;
				},
				onScrollerReady: (el: HTMLElement) => {
					el.scrollTo = ((o: ScrollToOptions) => scrolls.push(o.top ?? 0)) as never;
				},
			},
		});
		await vi.waitFor(() =>
			expect(vi.mocked(ipc.docGetSlice).mock.calls.some(([, p]) => p.length > 0)).toBe(true),
		);

		active.value = ['b'];
		flushSync();
		await vi.waitFor(() => expect(scrolls).toEqual([22]));
		release();
		for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));

		expect(scrolls.at(-1)).toBe(22);
	});
});
