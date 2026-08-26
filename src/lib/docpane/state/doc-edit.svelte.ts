import { ipc } from '$lib/ipc/client';
import { decodeLossless } from '$lib/ipc/wire';
import { describeError } from '$lib/ipc/error-copy';
import type { ContentRow, Row } from '$lib/views/tree/logic/model';
import type { ApplyResult, DocHandle, Op, Path } from '$lib/ipc/bindings';

export interface EditState {
	rowIndex: number;
	field: 'key' | 'value';
	buffer: string;
}

export interface DocEditDeps {
	rows: () => Row[];
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

	startKey = (rowIndex: number) => {
		const row = this.deps.rows()[rowIndex];
		if (row?.variant !== 'content') return;
		if (typeof row.key !== 'string' || row.depth === 0) return;
		this.deps.setError(null);
		this.state = { rowIndex, field: 'key', buffer: row.key };
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
				if (typeof full !== 'string' || this.deps.rows()[rowIndex] !== row) return;
				this.state = { rowIndex, field: 'value', buffer: full };
				return;
			}
			this.state = { rowIndex, field: 'value', buffer: row.preview.replace(/^"|"$/g, '') };
			return;
		}
		this.state = { rowIndex, field: 'value', buffer: row.preview };
	};

	input = (text: string) => {
		if (this.state) this.state = { ...this.state, buffer: text };
	};

	commit = async () => {
		if (!this.state) return;
		const { rowIndex, field, buffer } = this.state;
		const row = this.deps.rows()[rowIndex];
		this.state = null;
		if (row?.variant !== 'content') return;

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
