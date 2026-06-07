import type { LayoutResult, PositionedCard } from './layout';

export function searchCards(layout: LayoutResult, query: string): PositionedCard[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const out: PositionedCard[] = [];
	for (const card of layout.cards) {
		if (cardMatches(card, q)) out.push(card);
	}
	return out;
}

function cardMatches(card: PositionedCard, q: string): boolean {
	if (card.title.toLowerCase().includes(q)) return true;
	for (const row of card.rows) {
		if (row.key.toLowerCase().includes(q)) return true;
		if (row.value.toLowerCase().includes(q)) return true;
	}
	return false;
}
