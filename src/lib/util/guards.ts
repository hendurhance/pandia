
export function assertNever(x: never): never {
	throw new Error(`unhandled variant: ${String(x)}`);
}

export function oneOf<T extends string>(v: unknown, opts: readonly T[]): v is T {
	return typeof v === 'string' && (opts as readonly string[]).includes(v);
}
