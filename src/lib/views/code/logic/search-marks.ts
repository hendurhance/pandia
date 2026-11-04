import { RangeSetBuilder } from '@codemirror/state';
import {
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from '@codemirror/view';
import { getSearchQuery } from '@codemirror/search';

const match = Decoration.mark({ class: 'cm-searchMatch' });
const current = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' });

function marks(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const query = getSearchQuery(view.state);
	if (!query.search || !query.valid) return builder.finish();
	const { from: selFrom, to: selTo } = view.state.selection.main;
	let last = 0;
	for (const { from, to } of view.visibleRanges) {
		const cursor = query.getCursor(view.state, from, to);
		for (let next = cursor.next(); !next.done; next = cursor.next()) {
			const { from: f, to: t } = next.value;
			if (f < last) continue;
			builder.add(f, t, f === selFrom && t === selTo ? current : match);
			last = t;
		}
	}
	return builder.finish();
}

export const searchMarks = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = marks(view);
		}
		update(u: ViewUpdate) {
			const queryChanged = getSearchQuery(u.startState) !== getSearchQuery(u.state);
			if (queryChanged || u.docChanged || u.viewportChanged || u.selectionSet) {
				this.decorations = marks(u.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);
