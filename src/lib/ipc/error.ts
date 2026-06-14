export type IpcErrorKind =
	| 'notFound'
	| 'invalidPath'
	| 'tooLarge'
	| 'parse'
	| 'edit'
	| 'schema'
	| 'export'
	| 'io'
	| 'cancelled'
	| 'unknown';

export class IpcError extends Error {
	readonly kind: IpcErrorKind;
	constructor(kind: IpcErrorKind, message: string) {
		super(message);
		this.name = '';
		this.kind = kind;
	}
	toString(): string {
		return this.message;
	}
}

function isWireError(e: unknown): e is { kind: IpcErrorKind; message: string } {
	return (
		typeof e === 'object' &&
		e !== null &&
		typeof (e as { kind?: unknown }).kind === 'string' &&
		typeof (e as { message?: unknown }).message === 'string'
	);
}

export function toIpcError(e: unknown): unknown {
	return isWireError(e) ? new IpcError(e.kind, e.message) : e;
}
