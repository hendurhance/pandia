import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { DiffKind, Path, PathSegment } from '$lib/ipc/types';

export function stringifyWithOffsets(value: unknown): {
	text: string;
	offsets: Map<string, [number, number]>;
} {
	const out: string[] = [];
	const offsets = new Map<string, [number, number]>();
	let pos = 0;
	const path: PathSegment[] = [];
	const indent = 2;

	function write(s: string) {
		out.push(s);
		pos += s.length;
	}

	function pad(depth: number): string {
		return ' '.repeat(depth * indent);
	}

	function emit(v: unknown, depth: number) {
		const myPath = JSON.stringify([...path]);
		const start = pos;

		if (v === null) {
			write('null');
		} else if (typeof v === 'boolean') {
			write(v ? 'true' : 'false');
		} else if (typeof v === 'number') {
			write(String(v));
		} else if (typeof v === 'string') {
			write(JSON.stringify(v));
		} else if (Array.isArray(v)) {
			if (v.length === 0) {
				write('[]');
			} else {
				write('[\n');
				const childPad = pad(depth + 1);
				for (let i = 0; i < v.length; i++) {
					write(childPad);
					path.push(i);
					emit(v[i], depth + 1);
					path.pop();
					if (i < v.length - 1) write(',');
					write('\n');
				}
				write(pad(depth));
				write(']');
			}
		} else if (typeof v === 'object') {
			const obj = v as Record<string, unknown>;
			const keys = Object.keys(obj);
			if (keys.length === 0) {
				write('{}');
			} else {
				write('{\n');
				const childPad = pad(depth + 1);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					write(childPad);
					write(JSON.stringify(k));
					write(': ');
					path.push(k);
					emit(obj[k], depth + 1);
					path.pop();
					if (i < keys.length - 1) write(',');
					write('\n');
				}
				write(pad(depth));
				write('}');
			}
		}

		offsets.set(myPath, [start, pos]);
	}

	emit(value, 0);
	return { text: out.join(''), offsets };
}

export function lookupOffsets(
	offsets: Map<string, [number, number]>,
	path: Path,
): [number, number] | null {
	return offsets.get(JSON.stringify(path)) ?? null;
}

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
