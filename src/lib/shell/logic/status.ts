import type { NodeKind } from '$lib/ipc/bindings';

export type ValidityStatus =
	| { kind: 'buffer'; ok: boolean; detail?: string }
	| { kind: 'schema'; ok: boolean; errors: number };

export interface DocStatus {
	pathDisplay: string | null;
	kindDisplay: NodeKind | null;
	sizeDisplay: string | null;
	rootCountDisplay: string | null;
	lazy: boolean;
	validity: ValidityStatus | null;

	editing?: boolean;

	dirty?: boolean;
}
