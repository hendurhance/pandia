import type { ErrorKind, Path } from './bindings';

export type IpcErrorKind = ErrorKind | 'unknown';

export class IpcError extends Error {
	readonly kind: IpcErrorKind;
	readonly detail?: string;
	readonly path?: Path;
	readonly actual?: number;
	readonly limit?: number;
	constructor(
		kind: IpcErrorKind,
		message: string,
		extra?: { detail?: string; path?: Path; actual?: number; limit?: number },
	) {
		super(message);
		this.name = '';
		this.kind = kind;
		this.detail = extra?.detail;
		this.path = extra?.path;
		this.actual = extra?.actual;
		this.limit = extra?.limit;
	}
	toString(): string {
		return this.message;
	}
}

function isWireError(e: unknown): e is {
	kind: IpcErrorKind;
	message: string;
	detail?: string | null;
	path?: Path | null;
	actual?: number | null;
	limit?: number | null;
} {
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
		detail: typeof e.detail === 'string' ? e.detail : undefined,
		path: Array.isArray(e.path) ? e.path : undefined,
		actual: typeof e.actual === 'number' ? e.actual : undefined,
		limit: typeof e.limit === 'number' ? e.limit : undefined,
	});
}
