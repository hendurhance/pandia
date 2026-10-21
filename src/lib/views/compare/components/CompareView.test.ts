// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { DiffEntry, Path } from '$lib/ipc/bindings';
import { reactiveBox } from '$lib/views/shared/test-runes.svelte';
import CompareView from './CompareView.svelte';

// jsdom has no layout: CodeMirror measures text ranges after each change, and the entry list
// scrolls the selected entry into view.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docDiff: vi.fn(),
		docCanonicalText: vi.fn(),
		docCanonicalOffsets: vi.fn(),
		docSummary: vi.fn(async () => ({ rootKind: 'array', rootChildCount: 0 })),
		docDiffLines: vi.fn(async () => ({ hunks: [], leftLines: 1, rightLines: 1 })),
		cancelJob: vi.fn(async () => true),
	},
}));

let texts: Record<string, string> = {};
let entries: DiffEntry[] = [];

// Every test document is an array of one-letter strings, so element i spans [1 + 4i, 4 + 4i).
const props = {
	leftHandle: 'L' as never,
	rightHandle: 'R' as never,
	leftSourceSize: 20,
	rightSourceSize: 20,
	leftName: 'left.json',
	rightName: 'right.json',
	leftVersion: 1,
	rightVersion: 1,
};

function entry(e: Partial<DiffEntry> & Pick<DiffEntry, 'path' | 'kind'>): DiffEntry {
	return { leftPath: null, leftPreview: null, rightPreview: null, ...e };
}

function pane(container: HTMLElement, side: 0 | 1): HTMLElement {
	return container.querySelectorAll<HTMLElement>('.split .pane')[side]!;
}

beforeEach(() => {
	vi.mocked(ipc.docDiff).mockImplementation(async () => entries);
	vi.mocked(ipc.docCanonicalText).mockImplementation(async (h) => texts[h] as never);
	vi.mocked(ipc.docCanonicalOffsets).mockImplementation(async (_h, paths: Path[]) =>
		paths.map((p) => ({ start: 1 + 4 * (p[0] as number), end: 4 + 4 * (p[0] as number) })),
	);
});

describe('CompareView — side-by-side', () => {
	it('outlines where a moved element came from in the left pane', async () => {
		texts = { L: '["a","b","c"]', R: '["b","c","a"]' };
		entries = [entry({ path: [2], kind: 'moved', leftPath: [0], leftPreview: '"a"' })];
		const { container } = render(CompareView, { props });

		await vi.waitFor(() => {
			expect(pane(container, 0).querySelector('.cm-diff-active')?.textContent).toBe('"a"');
			expect(pane(container, 1).querySelector('.cm-diff-active')?.textContent).toBe('"a"');
		});
	});

	it('marks an edited item on its own row in the left pane after an insert above it', async () => {
		texts = { L: '["a","b","c","d"]', R: '["a","x","b","C","d"]' };
		entries = [
			entry({ path: [1], kind: 'added' }),
			entry({ path: [3], leftPath: [2], kind: 'changed' }),
		];
		const { container } = render(CompareView, { props });
		await vi.waitFor(() => expect(container.querySelectorAll('.entry')).toHaveLength(2));
		await fireEvent.click(container.querySelectorAll<HTMLElement>('.entry')[1]!);

		await vi.waitFor(() => {
			expect(pane(container, 0).querySelector('.cm-diff-changed')?.textContent).toBe('"c"');
			expect(pane(container, 0).querySelector('.cm-diff-active')?.textContent).toBe('"c"');
			expect(pane(container, 1).querySelector('.cm-diff-active')?.textContent).toBe('"C"');
		});
	});

	it('shows only the side that exists for added and removed entries', async () => {
		texts = { L: '["a","b"]', R: '["a","x"]' };
		entries = [
			entry({ path: [1], kind: 'removed', leftPreview: '"b"' }),
			entry({ path: [1], kind: 'added', rightPreview: '"x"' }),
		];
		const { container } = render(CompareView, { props });
		const previews = () =>
			[...container.querySelectorAll('.entry .preview')].map((p) => p.textContent?.trim());

		await vi.waitFor(() => expect(previews()).toEqual(['"b"', '"x"']));
	});

	it('keeps the selected entry when the diff recomputes', async () => {
		texts = { L: '["a","b","c"]', R: '["a","x","y"]' };
		entries = [entry({ path: [1], kind: 'changed' }), entry({ path: [2], kind: 'changed' })];
		const left = reactiveBox(1);
		const { container } = render(CompareView, {
			props: {
				...props,
				get leftVersion() {
					return left.value;
				},
			},
		});
		const active = () => container.querySelector('.entry.active .path')?.textContent;
		await vi.waitFor(() => expect(active()).toBe('$[1]'));
		await fireEvent.click(container.querySelectorAll<HTMLElement>('.entry')[1]!);
		expect(active()).toBe('$[2]');

		entries = [entry({ path: [0], kind: 'added' }), ...entries];
		left.value = 2;
		flushSync();
		await vi.waitFor(() => expect(container.querySelectorAll('.entry')).toHaveLength(3));
		expect(active()).toBe('$[2]');
	});

	it('recomputes the diff and reloads each pane when its document changes', async () => {
		texts = { L: '["a"]', R: '["b"]' };
		entries = [entry({ path: [0], kind: 'changed' })];
		// Getters keep each version its own signal, as DocPane passes them.
		const left = reactiveBox(1);
		const right = reactiveBox(1);
		const { container } = render(CompareView, {
			props: {
				...props,
				get leftVersion() {
					return left.value;
				},
				get rightVersion() {
					return right.value;
				},
			},
		});
		const paneText = (side: 0 | 1) =>
			pane(container, side).querySelector('.cm-content')?.textContent;
		const listed = () => [...container.querySelectorAll('.entry .path')].map((e) => e.textContent);
		await vi.waitFor(() => expect(paneText(0)).toBe('["a"]'));
		expect(listed()).toEqual(['$[0]']);

		texts = { L: '["a","x"]', R: '["b"]' };
		entries = [entry({ path: [0], kind: 'changed' }), entry({ path: [1], kind: 'removed' })];
		left.value = 2;
		flushSync();
		await vi.waitFor(() => expect(listed()).toEqual(['$[0]', '$[1]']));
		await vi.waitFor(() => expect(paneText(0)).toBe('["a","x"]'));

		texts = { L: '["a","x"]', R: '["a","x"]' };
		entries = [];
		right.value = 2;
		flushSync();
		await vi.waitFor(() =>
			expect(container.querySelector('.entries')?.textContent).toContain('No differences'),
		);
		await vi.waitFor(() => expect(paneText(1)).toBe('["a","x"]'));
	});

	it('reloads the tree and inline layouts when a document changes', async () => {
		texts = { L: '[]', R: '[]' };
		entries = [];
		const left = reactiveBox(1);
		const { container } = render(CompareView, {
			props: {
				...props,
				get leftVersion() {
					return left.value;
				},
			},
		});
		const { getByText } = within(container);
		const leftSummaries = () => vi.mocked(ipc.docSummary).mock.calls.filter(([h]) => h === 'L');

		await fireEvent.click(getByText('Tree'));
		await vi.waitFor(() => expect(leftSummaries()).toHaveLength(1));
		left.value = 2;
		flushSync();
		await vi.waitFor(() => expect(leftSummaries()).toHaveLength(2));

		await fireEvent.click(getByText('Inline'));
		await vi.waitFor(() => expect(ipc.docDiffLines).toHaveBeenCalledTimes(1));
		left.value = 3;
		flushSync();
		await vi.waitFor(() => expect(ipc.docDiffLines).toHaveBeenCalledTimes(2));
	});
});

describe('CompareView — sync scroll', () => {
	// jsdom has no layout: give a pane a size, and fire a scroll event for every scrollTop
	// write as browsers do (CodeMirror centers an entry by writing scrollTop).
	function sized(el: HTMLElement, scrollHeight: number): HTMLElement {
		let top = 0;
		Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
		Object.defineProperty(el, 'clientHeight', { value: 500 });
		Object.defineProperty(el, 'scrollTop', {
			get: () => top,
			set: (v: number) => {
				if (v === top) return;
				top = v;
				requestAnimationFrame(() => el.dispatchEvent(new Event('scroll')));
			},
		});
		return el;
	}
	const frames = async (n: number) => {
		for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
	};

	it('leaves each pane on the selected entry, then syncs your own scrolling', async () => {
		texts = { L: '["a","b","c"]', R: '["a","x","c"]' };
		entries = [entry({ path: [1], kind: 'changed' })];
		const { container } = render(CompareView, { props });
		await vi.waitFor(() => {
			expect(pane(container, 0).querySelector('.cm-diff-active')).not.toBeNull();
			expect(pane(container, 1).querySelector('.cm-diff-active')).not.toBeNull();
		});
		const left = sized(pane(container, 0).querySelector<HTMLElement>('.cm-scroller')!, 100_500);
		const right = sized(pane(container, 1).querySelector<HTMLElement>('.cm-scroller')!, 20_500);

		left.scrollTop = 80_000;
		await frames(2);
		right.scrollTop = 2_000;
		await frames(3);
		expect({ left: left.scrollTop, right: right.scrollTop }).toEqual({
			left: 80_000,
			right: 2_000,
		});

		left.dispatchEvent(new Event('wheel'));
		left.scrollTop = 50_000;
		await frames(3);
		expect(right.scrollTop).toBe(10_000);
	});
});

describe('CompareView — cancelling a running diff', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		texts = { L: '[]', R: '[]' };
		entries = [];
	});

	it('cancels the structural diff when a document changes and when compare closes', async () => {
		vi.mocked(ipc.docDiff).mockImplementation(() => new Promise(() => {}));
		const left = reactiveBox(1);
		const { unmount } = render(CompareView, {
			props: {
				...props,
				get leftVersion() {
					return left.value;
				},
			},
		});
		await vi.waitFor(() => expect(ipc.docDiff).toHaveBeenCalledTimes(1));
		left.value = 2;
		flushSync();
		await vi.waitFor(() => expect(ipc.docDiff).toHaveBeenCalledTimes(2));
		unmount();

		const ids = vi.mocked(ipc.docDiff).mock.calls.map(([, , id]) => id);
		expect(vi.mocked(ipc.cancelJob).mock.calls.map(([id]) => id)).toEqual(ids);
		expect(new Set(ids).size).toBe(2);
	});

	it('cancels the line diff when you leave the inline layout', async () => {
		vi.mocked(ipc.docDiffLines).mockImplementationOnce(() => new Promise(() => {}));
		const { container } = render(CompareView, { props });
		const { getByText } = within(container);

		await fireEvent.click(getByText('Inline'));
		await vi.waitFor(() => expect(ipc.docDiffLines).toHaveBeenCalledTimes(1));
		await fireEvent.click(getByText('Side-by-side'));

		const id = vi.mocked(ipc.docDiffLines).mock.calls[0]?.[2];
		expect(id).toEqual(expect.any(String));
		expect(ipc.cancelJob).toHaveBeenCalledWith(id);
	});
});
