import type { NodeKind, Op, Path } from '$lib/ipc/bindings';
import { kindOf } from '$lib/ipc/wire';
import { valueCommitOp } from '$lib/docpane/state/doc-edit.svelte';
import { MISSING, UNLOADED } from '../logic/grid-cell';

export interface GridEditDeps {
	path: () => Path;
	getRow: (rowIdx: number) => { index: number; value: unknown } | undefined;
	apply: (op: Op) => Promise<boolean>;
	openInTree: (cellPath: Path) => void;
	setError: (msg: string | null) => void;
}

export interface GridEditState {
	row: number;
	col: string;
	buffer: string;
	initial: string;
	kind: NodeKind | null;
}

const KIND_NAME: Record<NodeKind, string> = {
	object: 'an object',
	array: 'an array',
	string: 'a string',
	number: 'a number',
	bool: 'true or false',
	null: 'null',
};

function scalarText(v: unknown, kind: NodeKind): string {
	if (kind === 'string') return v as string;
	if (kind === 'null') return 'null';
	return String(v);
}

export class GridEditController {
	state: GridEditState | null = $state(null);

	constructor(private deps: GridEditDeps) {}

	start = (row: number, col: string, value: unknown) => {
		if (value === UNLOADED) return;
		const r = this.deps.getRow(row);
		if (!r) return;
		const cellPath = [...this.deps.path(), r.index, col];
		if (value === MISSING) {
			if (r.value === null || typeof r.value !== 'object' || Array.isArray(r.value)) {
				const kind = kindOf(r.value);
				this.deps.setError(`Row [${r.index}] is ${KIND_NAME[kind]}, so it has no keys to add.`);
				return;
			}
			this.state = { row, col, buffer: '', initial: '', kind: null };
			return;
		}
		const kind = kindOf(value);
		const multiLine = kind === 'string' && /[\r\n]/.test(value as string);
		if (kind === 'object' || kind === 'array' || multiLine) {
			this.deps.openInTree(cellPath);
			return;
		}
		const text = scalarText(value, kind);
		this.state = { row, col, buffer: text, initial: text, kind };
	};

	input = (text: string) => {
		if (this.state) this.state = { ...this.state, buffer: text };
	};

	cancel = () => {
		this.state = null;
	};

	commit = async (): Promise<boolean> => {
		const s = this.state;
		if (!s) return true;
		const r = this.deps.getRow(s.row);
		if (!r) {
			this.state = null;
			return true;
		}
		const rowPath = [...this.deps.path(), r.index];
		let op: Op | null;
		if (s.kind === null) {
			op = s.buffer === '' ? null : this.newKeyOp(rowPath, s.col, s.buffer);
		} else {
			const result = valueCommitOp(
				s.kind as Exclude<NodeKind, 'object' | 'array'>,
				[...rowPath, s.col],
				s.initial,
				s.buffer,
			);
			if (result !== null && 'error' in result) {
				this.deps.setError(result.error);
				return false;
			}
			op = result && s.buffer !== s.initial ? result.op : null;
		}
		this.state = null;
		this.deps.setError(null);
		if (op) await this.deps.apply(op);
		return true;
	};

	private newKeyOp(rowPath: Path, key: string, buffer: string): Op {
		let text: string;
		try {
			JSON.parse(buffer);
			text = buffer;
		} catch {
			text = JSON.stringify(buffer);
		}
		return { kind: 'insertKeyText', path: rowPath, key, text, position: null };
	}
}
