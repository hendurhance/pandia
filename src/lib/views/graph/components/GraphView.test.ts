// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import type { NodeView } from '$lib/ipc/bindings';
import { layoutGraph, type PositionedCard } from '../logic/layout';
import GraphView, { type GraphViewApi } from './GraphView.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetSlice: vi.fn(), docChildCount: vi.fn() } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({
		isFullscreen: async () => false,
		setFullscreen: async () => {
			throw new Error('Fullscreen is not available');
		},
	}),
}));

vi.mock('../logic/layout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../logic/layout')>();
	return { ...actual, layoutGraph: vi.fn(actual.layoutGraph) };
});

globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

let doc: unknown;

function childCount(v: unknown): number | null {
	if (Array.isArray(v)) return v.length;
	return kindOf(v) === 'object' ? Object.keys(v as object).length : null;
}

function view(key: string | number, v: unknown): NodeView {
	return { key, kind: kindOf(v), preview: JSON.stringify(v), childCount: childCount(v) };
}

beforeEach(() => {
	vi.clearAllMocks();
	const at = (path: (string | number)[]) =>
		path.reduce((node, seg) => (node as Record<string | number, unknown>)[seg], doc);
	vi.mocked(ipc.docGetSlice).mockImplementation(async (_h, path, start, end) => {
		const v = at(path);
		const entries = Array.isArray(v)
			? v.map((x, i) => [i, x] as const)
			: Object.entries(v as object);
		return entries.slice(start, end).map(([k, x]) => view(k, x));
	});
	vi.mocked(ipc.docChildCount).mockImplementation(async (_h, path) => childCount(at(path)));
});
afterEach(() => cleanup());

function open(root: unknown) {
	doc = root;
	return render(GraphView, {
		props: {
			handle: 'h' as never,
			version: 1,
			rootKind: kindOf(root),
			rootChildCount: childCount(root),
			onPickPath: vi.fn(),
		},
	});
}

const cards = (): PositionedCard[] => vi.mocked(layoutGraph).mock.results.at(-1)?.value.cards ?? [];
const rowsOf = (id: string) =>
	cards()
		.find((c) => c.id === id)
		?.rows.map((r) => `${r.key}: ${r.value}`);

describe('GraphView — card budgets', () => {
	it('opening a 10,000-item array lays out at most 40 cards', async () => {
		open({ items: Array.from({ length: 10_000 }, (_, i) => ({ id: i })) });
		await vi.waitFor(() => expect(cards().length).toBeGreaterThan(1));

		expect(cards().length).toBeLessThanOrEqual(40);
	});

	it('Expand All stays within 500 cards', async () => {
		const group = Array.from({ length: 200 }, (_, i) => ({ id: i }));
		open(Object.fromEntries(Array.from({ length: 30 }, (_, g) => [`g${g}`, group])));
		await vi.waitFor(() => expect(cards().length).toBeGreaterThan(1));

		const expandAll = screen.getByRole('button', { name: 'Expand all' });
		await fireEvent.click(expandAll);
		await vi.waitFor(() => expect(expandAll).toHaveProperty('disabled', false));

		expect(cards().length).toBeLessThanOrEqual(500);
	});
});

describe('GraphView — Collapse all', () => {
	it('wins over an Expand all that is still running', async () => {
		const group = Array.from({ length: 200 }, (_, i) => ({ id: i }));
		open(Object.fromEntries(Array.from({ length: 30 }, (_, g) => [`g${g}`, group])));
		await vi.waitFor(() => expect(cards().length).toBeGreaterThan(1));

		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const fetch = vi.mocked(ipc.docGetSlice).getMockImplementation()!;
		vi.mocked(ipc.docGetSlice).mockImplementation(async (...args) => {
			await gate;
			return fetch(...args);
		});

		const expandAll = screen.getByRole('button', { name: 'Expand all' });
		await fireEvent.click(expandAll);
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		release();
		await vi.waitFor(() => expect(expandAll).toHaveProperty('disabled', false));

		expect(cards()).toHaveLength(1);
	});
});

describe('GraphView — search', () => {
	it('keeps the match counter in range when the graph shrinks', async () => {
		let api: GraphViewApi | null = null;
		doc = { items: Array.from({ length: 10 }, (_, i) => ({ id: i })) };
		const { container } = render(GraphView, {
			props: {
				handle: 'h' as never,
				version: 1,
				rootKind: 'object',
				rootChildCount: 1,
				onPickPath: vi.fn(),
				onReady: (a) => (api = a),
			},
		});
		await vi.waitFor(() => expect(cards()).toHaveLength(11));
		api!.openSearch();
		await fireEvent.input(await screen.findByLabelText('graph search query'), {
			target: { value: 'item' },
		});
		for (let i = 0; i < 4; i++) {
			await fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
		}
		const counter = () => container.querySelector('.sf-counter')?.textContent;
		expect(counter()).toBe('5 / 11');

		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(counter()).toBe('1 / 1');
	});
});

describe('GraphView — undo and redo', () => {
	it('shows the new values and keeps the cards you opened', async () => {
		const deep = (f: number) => ({ a: { b: { c: { d: { e: { f } } } } } });
		const { rerender } = open(deep(1));
		await vi.waitFor(() => expect(cards()).toHaveLength(5));
		await fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
		await vi.waitFor(() => expect(cards()).toHaveLength(6));

		doc = deep(2);
		await rerender({ version: 2 });

		await vi.waitFor(() => expect(rowsOf('["a","b","c","d","e"]')).toEqual(['f: 2']));
		expect(cards()).toHaveLength(6);
	});
});

describe('GraphView — errors', () => {
	it('shows a later error over the graph until dismissed', async () => {
		open({ name: 'ada' });
		await vi.waitFor(() => expect(cards()).toHaveLength(1));

		await fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
		await screen.findByText(/Fullscreen is not available/);
		expect(screen.getByRole('application', { name: 'JSON graph view' })).toBeTruthy();

		await fireEvent.click(
			within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss error' }),
		);
		expect(screen.queryByText(/Fullscreen is not available/)).toBeNull();
		expect(screen.getByRole('application', { name: 'JSON graph view' })).toBeTruthy();
	});

	it('shows a failed first load in place of the graph', async () => {
		vi.mocked(ipc.docGetSlice).mockRejectedValue(new Error('The file is gone'));
		open({ name: 'ada' });

		await screen.findByText(/The file is gone/);
		expect(screen.queryByRole('application', { name: 'JSON graph view' })).toBeNull();
	});
});
