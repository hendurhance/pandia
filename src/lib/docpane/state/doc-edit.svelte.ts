import { ipc } from '$lib/ipc/client';
import { decodeLossless } from '$lib/ipc/wire';
import { describeError } from '$lib/ipc/error-copy';
import type { ContentRow, Row } from '$lib/views/tree/logic/model';
import type { ApplyResult, DocHandle, Op, Path } from '$lib/ipc/bindings';
export interface EditState {
	path: Path;
	field: 'key' | 'value';
	buffer: string;
	initial: string;
}

export interface DocEditDeps {
	rows: () => Row[];
	indexOf: (path: Path) => number;
	handle: () => DocHandle | null;

	apply: (op: Op) => Promise<ApplyResult | null>;

	setError: (msg: string | null) => void;
}

export function valueCommitOp(
	kind: Exclude<ContentRow['kind'], 'object' | 'array'>,
	path: Path,
	preview: string,
	buffer: string,
): { op: Op } | { error: string } | null {
	if (kind === 'string')
		return { op: { kind: 'setValueText', path, text: JSON.stringify(buffer) } };
	if (buffer === preview) return null;
	try {
		JSON.parse(buffer);
	} catch (e) {
		return { error: `invalid ${kind}: ${(e as Error).message}` };
	}
	return { op: { kind: 'setValueText', path, text: buffer } };
}

export class DocEditController {
	state: EditState | null = $state(null);

	constructor(private deps: DocEditDeps) {}

	get active(): boolean {
		return this.state !== null;
	}

	private rowAt(path: Path): ContentRow | null {
		const row = this.deps.rows()[this.deps.indexOf(path)];
		return row?.variant === 'content' ? row : null;
	}

	startKey = (rowIndex: number) => {
		const row = this.deps.rows()[rowIndex];
		if (row?.variant !== 'content') return;
		if (typeof row.key !== 'string' || row.depth === 0) return;
		this.deps.setError(null);
		this.state = { path: row.path, field: 'key', buffer: row.key, initial: row.key };
	};

	startValue = async (rowIndex: number) => {
		const row = this.deps.rows()[rowIndex];
		if (row?.variant !== 'content') return;
		if (row.kind === 'object' || row.kind === 'array') return;
		this.deps.setError(null);
		if (row.kind === 'string') {
			if (row.preview.endsWith('…"')) {
				const handle = this.deps.handle();
				if (!handle) return;
				let full: unknown;
				try {
					full = decodeLossless(await ipc.docGetValue(handle, row.path));
				} catch (e) {
					this.deps.setError(describeError(e));
					return;
				}
				if (typeof full !== 'string' || this.rowAt(row.path) !== row) return;
				this.state = { path: row.path, field: 'value', buffer: full, initial: full };
				return;
			}
			const text = row.preview.replace(/^"|"$/g, '');
			this.state = { path: row.path, field: 'value', buffer: text, initial: text };
			return;
		}
		this.state = { path: row.path, field: 'value', buffer: row.preview, initial: row.preview };
	};

	input = (text: string) => {
		if (this.state) this.state = { ...this.state, buffer: text };
	};

	commit = async () => {
		if (!this.state) return;
		const { path, field, buffer, initial } = this.state;
		const row = this.rowAt(path);
		this.state = null;
		if (!row || buffer === initial) return;

		if (field === 'key') {
			if (typeof row.key !== 'string') return;
			if (buffer === row.key || buffer === '') return;
			await this.deps.apply({
				kind: 'renameKey',
				path: row.path.slice(0, -1),
				from: row.key,
				to: buffer,
			});
			return;
		}

		if (row.kind === 'object' || row.kind === 'array') return;
		const result = valueCommitOp(row.kind, row.path, row.preview, buffer);
		if (result === null) return;
		if ('error' in result) {
			this.deps.setError(result.error);
			return;
		}
		await this.deps.apply(result.op);
	};

	cancel = () => {
		this.state = null;
	};
}
