export type IpcErrorKind =
	| 'notFound'
	| 'invalidPath'
	| 'tooLarge'
	| 'rangeTooLarge'
	| 'parse'
	| 'edit'
	| 'schema'
	| 'export'
	| 'io'
	| 'cancelled'
	| 'unknown';

export class IpcError extends Error {
	readonly kind: IpcErrorKind;
	readonly actual?: number;
	readonly limit?: number;
	constructor(kind: IpcErrorKind, message: string, sizes?: { actual?: number; limit?: number }) {
		super(message);
		this.name = '';
		this.kind = kind;
		this.actual = sizes?.actual;
		this.limit = sizes?.limit;
	}
	toString(): string {
		return this.message;
	}
}

function isWireError(
	e: unknown,
): e is { kind: IpcErrorKind; message: string; actual?: number; limit?: number } {
	return (
		typeof e === 'object' &&
		e !== null &&
		typeof (e as { kind?: unknown }).kind === 'string' &&
		typeof (e as { message?: unknown }).message === 'string'
	);
}

export function toIpcError(e: unknown): unknown {
	if (!isWireError(e)) return e;
	return new IpcError(e.kind, e.message, {
		actual: typeof e.actual === 'number' ? e.actual : undefined,
		limit: typeof e.limit === 'number' ? e.limit : undefined,
	});
}
