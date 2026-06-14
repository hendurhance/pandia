import { describe, it, expect } from 'vitest';
import {
	pathId,
	isContainerKind,
	cardTitle,
	rowKeyLabel,
	hexColorOf,
	layoutGraph,
	type CardRow,
	type GraphCard,
} from './layout';

describe('pathId', () => {
	it('is the JSON of the path', () => {
		expect(pathId([])).toBe('[]');
		expect(pathId(['a', 0, 'b'])).toBe('["a",0,"b"]');
	});
});

describe('isContainerKind', () => {
	it('is true only for object/array', () => {
		expect(isContainerKind('object')).toBe(true);
		expect(isContainerKind('array')).toBe(true);
		expect(isContainerKind('string')).toBe(false);
		expect(isContainerKind('number')).toBe(false);
		expect(isContainerKind('null')).toBe(false);
	});
});

describe('cardTitle', () => {
	it('labels the root, object keys, and array indices (with their parent key)', () => {
		expect(cardTitle([])).toBe('root');
		expect(cardTitle(['a', 'b'])).toBe('b');
		expect(cardTitle(['users', 2])).toBe('users[2]');
		expect(cardTitle([5])).toBe('[5]'); // index at the root has no parent key
	});
});

describe('rowKeyLabel', () => {
	it('brackets numeric indices and passes string keys through', () => {
		expect(rowKeyLabel(3)).toBe('[3]');
		expect(rowKeyLabel('name')).toBe('name');
	});
});

describe('hexColorOf', () => {
	it('detects #rgb / #rrggbb / #rrggbbaa string values', () => {
		expect(hexColorOf('string', '#fff')).toBe('#fff');
		expect(hexColorOf('string', '#abcdef')).toBe('#abcdef');
		expect(hexColorOf('string', '#12345678')).toBe('#12345678');
	});
	it('returns null for non-hex strings, bad lengths, and non-string kinds', () => {
		expect(hexColorOf('string', 'red')).toBeNull();
		expect(hexColorOf('string', '#ff')).toBeNull();
		expect(hexColorOf('number', '#fff')).toBeNull();
	});
});

function leafRow(key: string): CardRow {
	return {
		key,
		value: '1',
		valueKind: 'number',
		colorHex: null,
		container: false,
		expandable: false,
		childPath: [],
		children: [],
	};
}
function containerRow(key: string, children: GraphCard[]): CardRow {
	return {
		key,
		value: '{…}',
		valueKind: 'object',
		colorHex: null,
		container: true,
		expandable: true,
		childPath: [],
		children,
	};
}
function card(id: string, rows: CardRow[]): GraphCard {
	return { id, path: JSON.parse(id), title: id, kind: 'object', rows, hue: 0 };
}

describe('layoutGraph', () => {
	it('places a single leaf root at the origin with no edges', () => {
		const out = layoutGraph(card('[]', [leafRow('x')]));
		expect(out.cards).toHaveLength(1);
		expect(out.edges).toHaveLength(0);
		expect(out.cards[0]).toMatchObject({ x: 0, y: 0 });
		expect(out.width).toBe(out.cards[0].w);
		expect(out.height).toBe(out.cards[0].h);
	});

	it('positions children to the right of the parent and emits one edge per link', () => {
		const child = card('["a"]', [leafRow('x')]);
		const root = card('[]', [containerRow('a', [child]), leafRow('b')]);
		const out = layoutGraph(root);

		expect(out.cards).toHaveLength(2);
		expect(out.edges).toHaveLength(1);
		expect(out.edges[0].id).toBe('[]->["a"]');

		const rootCard = out.cards.find((c) => c.id === '[]')!;
		const childCard = out.cards.find((c) => c.id === '["a"]')!;
		expect(rootCard.x).toBe(0); // depth 0 column
		expect(childCard.x).toBeGreaterThan(rootCard.x); // deeper column is further right

		for (const c of out.cards) expect(c.y).toBeGreaterThanOrEqual(0);
		expect(out.width).toBe(Math.max(...out.cards.map((c) => c.x + c.w)));
		expect(out.height).toBe(Math.max(...out.cards.map((c) => c.y + c.h)));
	});

	it('lays deeper subtrees into successively further-right columns', () => {
		const grandchild = card('["a","b"]', [leafRow('y')]);
		const childRow = containerRow('b', [grandchild]);
		const child = card('["a"]', [childRow]);
		const root = card('[]', [containerRow('a', [child])]);
		const out = layoutGraph(root);

		const xs = ['[]', '["a"]', '["a","b"]'].map((id) => out.cards.find((c) => c.id === id)!.x);
		expect(xs[0]).toBeLessThan(xs[1]);
		expect(xs[1]).toBeLessThan(xs[2]);
		expect(out.edges).toHaveLength(2);
	});
});
