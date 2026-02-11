/**
 * JSON Transform Utilities
 *
 * Provides functions for transforming JSON data structures.
 */

/**
 * Recursively sorts object keys alphabetically.
 * Arrays are preserved but their object elements are also sorted.
 */
export function sortObjectKeys(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(sortObjectKeys);
	}
	if (typeof obj === 'object' && obj !== null) {
		const sorted: Record<string, unknown> = {};
		Object.keys(obj as Record<string, unknown>)
			.sort()
			.forEach((key) => {
				sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
			});
		return sorted;
	}
	return obj;
}

/**
 * Flattens a nested object into a single-level object with dot-notation keys.
 * Arrays are not flattened, only nested objects.
 *
 * @example
 * flatten({ a: { b: 1 } }) // { "a.b": 1 }
 */
export function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key in obj) {
		const newKey = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			Object.assign(result, flatten(value as Record<string, unknown>, newKey));
		} else {
			result[newKey] = value;
		}
	}
	return result;
}

/**
 * Unflattens a dot-notation object back into a nested structure.
 *
 * @example
 * unflatten({ "a.b": 1 }) // { a: { b: 1 } }
 */
export function unflatten(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key in obj) {
		const keys = key.split('.');
		let current: Record<string, unknown> = result;
		for (let i = 0; i < keys.length - 1; i++) {
			if (!(keys[i] in current)) {
				current[keys[i]] = {};
			}
			current = current[keys[i]] as Record<string, unknown>;
		}
		current[keys[keys.length - 1]] = obj[key];
	}
	return result;
}

/**
 * List of keys that are considered sensitive and should be masked.
 */
const SENSITIVE_KEYS = ['password', 'secret', 'token', 'key', 'api_key', 'auth', 'credential'];

/**
 * Masks values of keys that contain sensitive keywords.
 * Recursively processes nested objects and arrays.
 */
export function maskSensitiveData(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(maskSensitiveData);
	}
	if (typeof obj === 'object' && obj !== null) {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
				result[key] = '***MASKED***';
			} else {
				result[key] = maskSensitiveData(value);
			}
		}
		return result;
	}
	return obj;
}
