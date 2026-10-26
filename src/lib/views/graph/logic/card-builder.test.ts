import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { kindOf } from '$lib/ipc/wire';
import type { NodeView } from '$lib/ipc/bindings';
import { buildCard, expandRow, openRows, reopenRows, showMore, toRow } from './card-builder';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetSlice: vi.fn(), docChildCount: vi.fn() } }));

let doc: unknown;

function childCount(v: unknown): number | null {
	if (Array.isArray(v)) return v.length;
	return kindOf(v) === 'object' ? Object.keys(v as object).length : null;
}

function view(key: string | number, v: unknown): NodeView {
	return { key, kind: kindOf(v), preview: JSON.stringify(v), childCount: childCount(v) };
}

beforeEach(() => {
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

describe('expandRow — a long array of objects', () => {
	const items = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));

	it('shows the first 100 items, then a "… N more" card', async () => {
		doc = { items };
		const row = toRow([], view('items', items));
		await expandRow('h' as never, row);

		expect(row.children).toHaveLength(101);
		expect(row.children[99]?.title).toBe('items[99]');
		expect(row.children[100]?.title).toBe('… 9,900 more');
	});

	it('clicking the "… N more" card shows the next 100', async () => {
		doc = { items };
		const row = toRow([], view('items', items));
		await expandRow('h' as never, row);
		await showMore('h' as never, row.children[100]!.more!);

		expect(row.children).toHaveLength(201);
		expect(row.children[199]?.title).toBe('items[199]');
		expect(row.children[200]?.title).toBe('… 9,800 more');
	});

	it('adds no more cards than the caller allows', async () => {
		doc = { items };
		const row = toRow([], view('items', items));
		await expandRow('h' as never, row, 25);

		expect(row.children).toHaveLength(25);
		expect(row.children[24]?.title).toBe('… 9,976 more');
	});
});

describe('buildCard — more children than a card shows', () => {
	it('ends the card with a "… N more" row for the children it leaves out', async () => {
		doc = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));
		const card = await buildCard('h' as never, [], 'array');

		expect(card.rows).toHaveLength(5001);
		expect(card.rows[4999]?.key).toBe('[4999]');
		expect(card.rows[5000]).toMatchObject({ key: '…', value: '5,000 more', expandable: false });
	});
});

describe('reopenRows — rebuilding after an edit', () => {
	const h = 'h' as never;
	// Opens `users`, then the `pet` row of users[1].
	async function openGraph() {
		const root = await buildCard(h, [], 'object');
		await expandRow(h, root.rows[0]!);
		await expandRow(h, root.rows[0]!.children[1]!.rows[0]!);
		return root;
	}

	async function rebuilt(before: Awaited<ReturnType<typeof openGraph>>) {
		const after = await buildCard(h, [], 'object');
		await reopenRows(h, after, openRows(before));
		return after;
	}

	it('reopens everything when no array changed length', async () => {
		doc = { users: [{ pet: { n: 'a' } }, { pet: { n: 'b' } }] };
		const before = await openGraph();
		doc = { users: [{ pet: { n: 'a' } }, { pet: { n: 'B' } }] };
		const after = await rebuilt(before);
		expect(after.rows[0]!.children[1]!.rows[0]!.children).toHaveLength(1);
	});

	it('leaves the items of an array that changed length closed, since they may have shifted', async () => {
		doc = { users: [{ pet: { n: 'a' } }, { pet: { n: 'b' } }, { pet: { n: 'c' } }] };
		const before = await openGraph();
		doc = { users: [{ pet: { n: 'b' } }, { pet: { n: 'c' } }] };
		const after = await rebuilt(before);
		expect(after.rows[0]!.children).toHaveLength(2);
		expect(after.rows[0]!.children[1]!.rows[0]!.children).toHaveLength(0);
	});
});
