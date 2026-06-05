import type { NodeKind, Path, PathSegment } from '$lib/ipc/types';

export interface CardRow {
	
	key: string;
	
	value: string;
	valueKind: NodeKind;
	
	colorHex: string | null;
	
	container: boolean;
	
	expandable: boolean;
	
	childPath: Path;
	
	children: GraphCard[];
}

export interface GraphCard {
	id: string; // JSON of path
	path: Path;
	title: string;
	kind: NodeKind; // object | array
	rows: CardRow[];
	
	hue: number;
}

export interface PositionedCard {
	id: string;
	path: Path;
	title: string;
	kind: NodeKind;
	rows: CardRow[];
	hue: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface CardEdge {
	id: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface LayoutResult {
	cards: PositionedCard[];
	edges: CardEdge[];
	width: number;
	height: number;
}

export const HEADER_H = 30;
export const ROW_H = 26;
const H_GAP = 80; // between depth columns
const V_GAP = 26; // between stacked cards
const CHAR_W = 7.8; // IBM Plex Mono @ 13px
const PAD_X = 28; // card left+right padding
const PORT_W = 18; // extra room for a container row's port stub
const MIN_W = 140;
const MAX_W = 340;

function cardWidth(card: GraphCard): number {
	let chars = card.title.length;
	for (const r of card.rows) {
		let n = r.key.length + 2 + r.value.length;
		if (r.colorHex) n += 2;
		chars = Math.max(chars, n);
	}
	const hasPort = card.rows.some((r) => r.container);
	const w = chars * CHAR_W + PAD_X + (hasPort ? PORT_W : 0);
	return Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
}

function cardHeight(card: GraphCard): number {
	return HEADER_H + card.rows.length * ROW_H;
}

export function layoutGraph(root: GraphCard): LayoutResult {
	const maxW: number[] = [];
	(function measure(card: GraphCard, depth: number) {
		maxW[depth] = Math.max(maxW[depth] ?? 0, cardWidth(card));
		for (const r of card.rows) for (const ch of r.children) measure(ch, depth + 1);
	})(root, 0);

	const colX: number[] = [];
	let acc = 0;
	for (let d = 0; d < maxW.length; d++) {
		colX[d] = acc;
		acc += maxW[d] + H_GAP;
	}

	const cards: PositionedCard[] = [];
	const edges: CardEdge[] = [];
	let nextY = 0;

	function place(card: GraphCard, depth: number): PositionedCard {
		const x = colX[depth];
		const w = cardWidth(card);
		const h = cardHeight(card);
		const childCards = card.rows.flatMap((r) => r.children);

		const placed = new Map<string, PositionedCard>();
		let y: number;
		if (childCards.length === 0) {
			y = nextY;
			nextY += h + V_GAP;
		} else {
			for (const ch of childCards) placed.set(ch.id, place(ch, depth + 1));
			const first = placed.get(childCards[0].id)!;
			const last = placed.get(childCards[childCards.length - 1].id)!;
			y = (first.y + last.y + last.h) / 2 - h / 2;
			nextY = Math.max(nextY, y + h + V_GAP); // keep packing monotonic
		}

		const pc: PositionedCard = {
			id: card.id,
			path: card.path,
			title: card.title,
			kind: card.kind,
			rows: card.rows,
			hue: card.hue,
			x,
			y,
			w,
			h,
		};
		cards.push(pc);

		card.rows.forEach((r, rowIndex) => {
			if (r.children.length === 0) return;
			const portY = y + HEADER_H + (rowIndex + 0.5) * ROW_H;
			for (const ch of r.children) {
				const child = placed.get(ch.id)!;
				edges.push({
					id: `${card.id}->${ch.id}`,
					x1: x + w,
					y1: portY,
					x2: child.x,
					y2: child.y + child.h / 2,
				});
			}
		});

		return pc;
	}

	place(root, 0);

	const minY = Math.min(0, ...cards.map((c) => c.y));
	if (minY < 0) {
		for (const c of cards) c.y -= minY;
		for (const e of edges) {
			e.y1 -= minY;
			e.y2 -= minY;
		}
	}

	const width = Math.max(0, ...cards.map((c) => c.x + c.w));
	const height = Math.max(0, ...cards.map((c) => c.y + c.h));
	return { cards, edges, width, height };
}

export function pathId(path: Path): string {
	return JSON.stringify(path);
}

export function isContainerKind(kind: NodeKind): boolean {
	return kind === 'object' || kind === 'array';
}

export function cardTitle(path: Path): string {
	if (path.length === 0) return 'root';
	const last = path[path.length - 1];
	if (typeof last === 'number') {
		const parent = path[path.length - 2];
		return parent === undefined ? `[${last}]` : `${parent}[${last}]`;
	}
	return String(last);
}

export function rowKeyLabel(seg: PathSegment): string {
	return typeof seg === 'number' ? `[${seg}]` : seg;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export function hexColorOf(kind: NodeKind, value: string): string | null {
	return kind === 'string' && HEX_RE.test(value) ? value : null;
}
