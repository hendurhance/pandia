import type { NodeKind } from '$lib/ipc/bindings';
import { isLosslessNumber, kindOf } from '$lib/ipc/wire';

export const UNLOADED = Symbol('unloaded');

export const MISSING = Symbol('missing');

export function cellText(v: unknown): string {
	if (v === null) return '—';
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'number') return String(v);
	if (isLosslessNumber(v)) return v.toString();
	if (typeof v === 'string') {
		const max = 500;
		return v.length > max ? v.slice(0, max) + '…' : v;
	}
	if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length} items]`;
	const keys = Object.keys(v as object);
	return keys.length === 0 ? '{}' : `{${keys.length} keys}`;
}

export function isAlignRight(kind: NodeKind): boolean {
	return kind === 'number';
}

export function cellClass(v: unknown): string {
	if (v === UNLOADED) return 'cell unloaded';
	if (v === MISSING) return 'cell missing';
	const k = kindOf(v);
	const align = isAlignRight(k) ? ' right' : '';
	return `cell ${k}${align}`;
}

export function cellRender(v: unknown): string {
	if (v === UNLOADED) return '…';
	if (v === MISSING) return '';
	return cellText(v);
}

export function cellTitle(v: unknown): string | undefined {
	if (v === UNLOADED || v === MISSING) return undefined;
	if (typeof v === 'string') return v;
	if (v === null) return 'null';
	if (isLosslessNumber(v)) return v.toString();
	if (typeof v === 'object') {
		try {
			return JSON.stringify(v);
		} catch {
			return undefined;
		}
	}
	return String(v);
}

export function inspectorText(v: unknown): string {
	if (v === UNLOADED) return 'loading…';
	if (v === MISSING) return '(no value)';
	if (typeof v === 'string') return v;
	if (v === null) return 'null';
	if (isLosslessNumber(v)) return v.toString();
	if (typeof v === 'object') return JSON.stringify(v, null, 2);
	return String(v);
}
