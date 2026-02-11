export type Result<T> =
	| { success: true; data: T }
	| { success: false; error: string };

export function formatError(err: unknown, fallback = 'Unknown error'): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	try {
		return JSON.stringify(err);
	} catch {
		return fallback;
	}
}

export function isError(result: Result<unknown>): result is { success: false; error: string } {
	return !result.success;
}

export function createError(error: string): Result<never> {
	return { success: false, error };
}

export function createSuccess<T>(data: T): Result<T> {
	return { success: true, data };
}

/** Type guard: Check if value is a plain object (not null, not array) */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Progress callback for single-item operations */
export type ProgressCallback = (progress: number) => void;

/** Progress callback for multi-file operations (includes filename) */
export type FileProgressCallback = (fileName: string, progress: number) => void;
