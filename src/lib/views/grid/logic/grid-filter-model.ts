import type { GridFilter } from '$lib/ipc/doc';

export type ColOp = 'is' | 'isNot' | 'contains' | 'startsWith';

export interface ColFilter {
	op?: ColOp; // text/value operator (default 'is')
	values?: unknown[]; // checklist selection (is / isNot)
	text?: string; // text box (contains / startsWith / exact on capped cols)
	min?: string;
	max?: string;
	presence?: 'empty' | 'notEmpty';
}

export const OP_LABEL: Record<ColOp, string> = {
	is: 'is',
	isNot: 'is not',
	contains: 'contains',
	startsWith: 'starts with',
};

export const sameVal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function colActive(c: ColFilter): boolean {
	return !!(c.values?.length || c.text?.trim() || c.min?.trim() || c.max?.trim() || c.presence);
}

export function compileGroups(groups: Map<string, ColFilter>[]): GridFilter[][] {
	return groups.map(compileFilters).filter((g) => g.length > 0);
}

export function compileFilters(colFilters: Map<string, ColFilter>): GridFilter[] {
	const out: GridFilter[] = [];
	for (const [key, c] of colFilters) {
		const op = c.op ?? 'is';
		if ((op === 'is' || op === 'isNot') && c.values?.length) {
			out.push({ key, op: op === 'is' ? 'in' : 'notIn', value: c.values });
		} else if ((op === 'is' || op === 'isNot') && c.text?.trim()) {
			out.push({ key, op: op === 'is' ? 'eq' : 'ne', value: c.text.trim() });
		} else if (op === 'contains' && c.text?.trim()) {
			out.push({ key, op: 'contains', value: c.text.trim() });
		} else if (op === 'startsWith' && c.text?.trim()) {
			out.push({ key, op: 'startsWith', value: c.text.trim() });
		}
		if (c.min?.trim()) out.push({ key, op: 'gte', value: Number(c.min) });
		if (c.max?.trim()) out.push({ key, op: 'lte', value: Number(c.max) });
		if (c.presence === 'empty') out.push({ key, op: 'isEmpty' });
		else if (c.presence === 'notEmpty') out.push({ key, op: 'isNotEmpty' });
	}
	return out;
}

export function valLabel(v: unknown): string {
	if (v === null || v === undefined) return '(empty)';
	if (typeof v === 'string') return v === '' ? '(empty)' : v;
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
	return String(v);
}

export function colValueLabel(cv: { value: unknown; label?: string | null }): string {
	return cv.label ?? valLabel(cv.value);
}

export function chipSummary(c: ColFilter): string {
	const parts: string[] = [];
	const op = c.op ?? 'is';
	if (c.values?.length) {
		const verb = op === 'isNot' ? 'is not ' : 'is ';
		parts.push(
			verb + (c.values.length <= 2 ? c.values.map(valLabel).join(', ') : `${c.values.length} of`),
		);
	} else if (c.text?.trim()) {
		parts.push(`${OP_LABEL[op]} "${c.text.trim()}"`);
	}
	if (c.min?.trim() || c.max?.trim())
		parts.push(`${c.min?.trim() || '−∞'}–${c.max?.trim() || '∞'}`);
	if (c.presence === 'empty') parts.push('is empty');
	else if (c.presence === 'notEmpty') parts.push('is not empty');
	return parts.join(' · ');
}
