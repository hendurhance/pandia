// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import type { NodeView } from '$lib/ipc/bindings';
import { HEADER_H, ROW_H, layoutGraph, type PositionedCard } from '../logic/layout';
import { centerOn } from '../logic/viewport';
import GraphView, { type GraphViewApi } from './GraphView.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetSlice: vi.fn(), docChildCount: vi.fn() } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
const win = vi.hoisted(() => ({
	isFullscreen: vi.fn<() => Promise<boolean>>(),
	setFullscreen: vi.fn<(fullscreen: boolean) => Promise<void>>(),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => win }));

vi.mock('../logic/layout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../logic/layout')>();
	return { ...actual, layoutGraph: vi.fn(actual.layoutGraph) };
});

vi.mock('../logic/viewport', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../logic/viewport')>();
	return { ...actual, centerOn: vi.fn(actual.centerOn) };
});

globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
window.matchMedia ??= (() => ({
	addEventListener() {},
	removeEventListener() {},
})) as unknown as typeof window.matchMedia;

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
	win.isFullscreen.mockImplementation(async () => false);
	win.setFullscreen.mockImplementation(async () => {
		throw new Error('Fullscreen is not available');
	});
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

	const press = async (x: number, y: number) => {
		const canvas = document.querySelector('canvas')!;
		canvas.setPointerCapture = () => {};
		const at = { button: 0, pointerId: 1, clientX: 40 + x, clientY: 40 + y };
		await fireEvent.pointerDown(canvas, at);
		await fireEvent.pointerUp(canvas, at);
	};

	it('shows a failed port expand', async () => {
		open({ a: { b: { c: { d: { e: { f: 1 } } } } } });
		await vi.waitFor(() => expect(cards()).toHaveLength(5));
		const d = cards().find((c) => c.id === '["a","b","c","d"]')!;
		vi.mocked(ipc.docGetSlice).mockRejectedValue(new Error('The file is gone'));

		await press(d.x + d.w, d.y + HEADER_H + ROW_H / 2);

		await screen.findByText(/The file is gone/);
	});

	it('shows a failed "… more" page', async () => {
		open({ items: Array.from({ length: 200 }, (_, i) => ({ id: i })) });
		await vi.waitFor(() => expect(cards().some((c) => c.more)).toBe(true));
		const more = cards().find((c) => c.more)!;
		vi.mocked(ipc.docGetSlice).mockRejectedValue(new Error('The file is gone'));

		await press(more.x + 10, more.y + 10);

		await screen.findByText(/The file is gone/);
	});

	it('ignores the error of a load that a newer document replaced', async () => {
		doc = { name: 'ada' };
		const fetch = vi.mocked(ipc.docGetSlice).getMockImplementation()!;
		let failOld!: (e: Error) => void;
		const old = new Promise<never>((_, reject) => (failOld = reject));
		let releaseNew!: () => void;
		const next = new Promise<void>((r) => (releaseNew = r));
		vi.mocked(ipc.docGetSlice).mockImplementation(async (h, ...rest) => {
			await (h === ('old' as never) ? old : next);
			return fetch(h, ...rest);
		});
		const { rerender } = render(GraphView, {
			props: {
				handle: 'old' as never,
				version: 1,
				rootKind: 'object',
				rootChildCount: 1,
				onPickPath: vi.fn(),
			},
		});
		await vi.waitFor(() => expect(ipc.docGetSlice).toHaveBeenCalledTimes(1));
		await rerender({ handle: 'new' as never });
		await vi.waitFor(() => expect(ipc.docGetSlice).toHaveBeenCalledTimes(2));

		failOld(new Error('The old file is gone'));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText(/The old file is gone/)).toBeNull();
		expect(screen.getByText('building graph…')).toBeTruthy();

		releaseNew();
		await screen.findByRole('application', { name: 'JSON graph view' });
		expect(screen.queryByText(/The old file is gone/)).toBeNull();
	});
});

describe('GraphView — search while expanding', () => {
	it('re-centres only when the active match changes', async () => {
		const w = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
		const h = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
		onTestFinished(() => {
			w.mockRestore();
			h.mockRestore();
		});
		let api: GraphViewApi | null = null;
		doc = { a: { b: { c: { d: { e: { f: 1 } } } } } };
		render(GraphView, {
			props: {
				handle: 'h' as never,
				version: 1,
				rootKind: 'object',
				rootChildCount: 1,
				onPickPath: vi.fn(),
				onReady: (a) => (api = a),
			},
		});
		await vi.waitFor(() => expect(cards()).toHaveLength(5));
		api!.openSearch();
		await fireEvent.input(await screen.findByLabelText('graph search query'), {
			target: { value: 'a' },
		});
		await vi.waitFor(() => expect(centerOn).toHaveBeenCalled());
		const centred = vi.mocked(centerOn).mock.calls.length;

		const expandAll = screen.getByRole('button', { name: 'Expand all' });
		await fireEvent.click(expandAll);
		await vi.waitFor(() => expect(cards()).toHaveLength(6));
		await vi.waitFor(() => expect(expandAll).toHaveProperty('disabled', false));

		expect(vi.mocked(centerOn).mock.calls.length).toBe(centred);
	});
});

describe('GraphView — fullscreen', () => {
	it('follows a fullscreen change made outside the graph', async () => {
		let fullscreen = true;
		win.isFullscreen.mockImplementation(async () => fullscreen);
		win.setFullscreen.mockImplementation(async (v) => void (fullscreen = v));
		open({ name: 'ada' });
		await screen.findByRole('button', { name: 'Exit fullscreen' });

		fullscreen = false;
		window.dispatchEvent(new Event('resize'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Enter fullscreen' }));

		expect(win.setFullscreen).toHaveBeenLastCalledWith(true);
	});
});
