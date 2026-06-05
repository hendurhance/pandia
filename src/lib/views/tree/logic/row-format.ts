import type { ContentRow } from './model';

export function chipText(row: ContentRow): string | null {
	if (row.kind === 'object') {
		if (row.childCount === null) return '{…}';
		return row.childCount === 1 ? `{1 prop}` : `{${row.childCount} props}`;
	}
	if (row.kind === 'array') {
		if (row.childCount === null) return '[…]';
		return row.childCount === 1 ? `[1 item]` : `[${row.childCount} items]`;
	}
	return null;
}

export function openBracket(row: ContentRow): string {
	return row.kind === 'array' ? '[' : '{';
}

export function renderKey(row: ContentRow): string {
	if (row.depth === 0) return '$';
	if (typeof row.key === 'number') return `[${row.key}]`;
	return String(row.key);
}

const URL_RE = /^"(https?:\/\/[^\s"]+)"$/;

export function detectUrl(preview: string): string | null {
	const m = URL_RE.exec(preview);
	return m ? m[1] : null;
}
