import { describe, expect, it } from 'vitest';
import { searchCards } from './card-search';
import type { LayoutResult, PositionedCard } from './layout';
import type { NodeKind } from '$lib/ipc/types';

function card(
	id: string,
	title: string,
	rows: { key: string; value: string }[] = [],
): PositionedCard {
	return {
		id,
		path: [],
		title,
		kind: 'object' as NodeKind,
		rows: rows.map((r) => ({
			key: r.key,
			value: r.value,
			valueKind: 'string' as NodeKind,
			colorHex: null,
			container: false,
			expandable: false,
			childPath: [],
			children: [],
		})),
		hue: 0,
		x: 0,
		y: 0,
		w: 200,
		h: 100,
	};
}

function lay(cards: PositionedCard[]): LayoutResult {
	return { cards, edges: [], width: 0, height: 0 };
}

describe('searchCards', () => {
	it('returns [] for an empty query', () => {
		expect(searchCards(lay([card('a', 'foo')]), '')).toEqual([]);
		expect(searchCards(lay([card('a', 'foo')]), '   ')).toEqual([]);
	});

	it('matches by title (case-insensitive)', () => {
		const a = card('a', 'Fruits');
		const b = card('b', 'nutrients');
		const result = searchCards(lay([a, b]), 'FRUIT');
		expect(result).toEqual([a]);
	});

	it('matches by row key', () => {
		const a = card('a', 'root', [{ key: 'apple', value: '1' }]);
		const b = card('b', 'root', [{ key: 'banana', value: '2' }]);
		const result = searchCards(lay([a, b]), 'app');
		expect(result).toEqual([a]);
	});

	it('matches by row value', () => {
		const a = card('a', 'root', [{ key: 'k', value: 'hello world' }]);
		const b = card('b', 'root', [{ key: 'k', value: 'goodbye' }]);
		const result = searchCards(lay([a, b]), 'world');
		expect(result).toEqual([a]);
	});

	it('preserves layout order in results', () => {
		const a = card('a', 'apple');
		const b = card('b', 'application');
		const c = card('c', 'banana');
		const d = card('d', 'apple-pie');
		const result = searchCards(lay([a, b, c, d]), 'app');
		expect(result.map((c) => c.id)).toEqual(['a', 'b', 'd']);
	});

	it('multi-field hit returns the card once (no dup)', () => {
		const a = card('a', 'apple', [{ key: 'k', value: 'green apple' }]);
		expect(searchCards(lay([a]), 'apple').length).toBe(1);
	});

	it('no matches returns []', () => {
		expect(searchCards(lay([card('a', 'foo')]), 'xyz')).toEqual([]);
	});
});
