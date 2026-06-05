import type { NodeKind } from '$lib/ipc/types';

export type ValidityStatus =
	| { kind: 'buffer'; ok: boolean; detail?: string }
	| { kind: 'schema'; ok: boolean; errors: number };

export interface DocStatus {
	pathDisplay: string | null;
	kindDisplay: NodeKind | null;
	sizeDisplay: string | null;
	lazy: boolean;
	validity: ValidityStatus | null;
	
	editing?: boolean;
	
	dirty?: boolean;
}

function validityEq(a: ValidityStatus | null, b: ValidityStatus | null): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (a.kind === 'buffer' && b.kind === 'buffer') return a.ok === b.ok && a.detail === b.detail;
	if (a.kind === 'schema' && b.kind === 'schema') return a.ok === b.ok && a.errors === b.errors;
	return false;
}

export function statusEq(a: DocStatus | null, b: DocStatus | null): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	return (
		a.pathDisplay === b.pathDisplay &&
		a.kindDisplay === b.kindDisplay &&
		a.sizeDisplay === b.sizeDisplay &&
		a.lazy === b.lazy &&
		validityEq(a.validity, b.validity) &&
		!!a.editing === !!b.editing &&
		!!a.dirty === !!b.dirty
	);
}
