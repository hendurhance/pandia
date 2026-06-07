import { docGetValue } from '$lib/ipc/doc';
import type { ContentRow, Row } from '$lib/views/tree/logic/model';
import type { ApplyResult, DocHandle, Op } from '$lib/ipc/types';

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

const INVALID = Symbol('invalid');

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
			const handle = this.deps.handle();
			if (row.preview.endsWith('…"') && handle) {
				try {
					const full = await docGetValue(handle, row.path);
					if (typeof full === 'string' && this.deps.rows()[rowIndex] === row) {
						this.state = { rowIndex, field: 'value', buffer: full };
						return;
					}
				} catch {}
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
		const parsed = this.parseValue(buffer, row.kind);
		if (parsed === INVALID) return;
		await this.deps.apply({ kind: 'setValue', path: row.path, value: parsed });
	};

	cancel = () => {
		this.state = null;
	};

	private parseValue(text: string, kind: ContentRow['kind']): unknown | typeof INVALID {
		if (kind === 'string') return text;
		try {
			return JSON.parse(text);
		} catch (e) {
			this.deps.setError(`invalid ${kind}: ${(e as Error).message}`);
			return INVALID;
		}
	}
}
