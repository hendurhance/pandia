import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { DiffKind, Path } from '$lib/ipc/bindings';

export interface Highlight {
	path: Path;
	kind: DiffKind;
}

export interface HighlightState {
	ranges: Array<{ from: number; to: number; kind: DiffKind }>;
	active: { from: number; to: number } | null;
}

export const setHighlights = StateEffect.define<HighlightState>();

const diffMark = (kind: DiffKind) => Decoration.mark({ class: `cm-diff-${kind}`, inclusive: true });
const activeMark = Decoration.mark({ class: 'cm-diff-active', inclusive: true });

const highlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setHighlights)) {
				const items: { from: number; to: number; deco: Decoration }[] = [];
				for (const r of e.value.ranges) {
					if (r.from >= 0 && r.to > r.from) {
						items.push({ from: r.from, to: r.to, deco: diffMark(r.kind) });
					}
				}
				if (e.value.active) {
					items.push({
						from: e.value.active.from,
						to: e.value.active.to,
						deco: activeMark,
					});
				}
				items.sort((a, b) => a.from - b.from || a.to - b.to);
				deco = Decoration.set(items.map((i) => i.deco.range(i.from, i.to)));
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export function diffHighlightExtension(): Extension {
	return [highlightField];
}

export function highlightsForSide(
	entries: Array<{ path: Path; kind: DiffKind }>,
	side: 'left' | 'right',
): Highlight[] {
	return entries
		.filter((e) =>
			side === 'left'
				? e.kind === 'removed' || e.kind === 'changed'
				: e.kind === 'added' || e.kind === 'changed',
		)
		.map((e) => ({ path: e.path, kind: e.kind }));
}
