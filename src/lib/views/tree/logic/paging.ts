import type { Path } from '$lib/ipc/bindings';
import { pathKey, type Row } from './model';

export async function findIndexPaged<T>(
	fetch: (start: number, end: number) => Promise<T[]>,
	match: (item: T) => boolean,
	chunk: number,
	maxStart: number,
): Promise<number | null> {
	let start = 0;
	while (true) {
		const slice = await fetch(start, start + chunk);
		const local = slice.findIndex(match);
		if (local >= 0) return start + local;
		if (slice.length < chunk) return null;
		start += chunk;
		if (start > maxStart) return null;
	}
}

export function placeholderChunks(
	rows: readonly Row[],
	start: number,
	end: number,
	chunk: number,
): Array<{ parentPath: Path; parentDepth: number; chunkStart: number }> {
	const out: Array<{ parentPath: Path; parentDepth: number; chunkStart: number }> = [];
	const picked = new Set<string>();
	for (let i = start; i < end && i < rows.length; i++) {
		const r = rows[i];
		if (!r || r.variant !== 'placeholder') continue;
		const chunkStart = Math.floor(r.index / chunk) * chunk;
		const key = pathKey(r.parentPath) + '@' + chunkStart;
		if (picked.has(key)) continue;
		picked.add(key);
		out.push({ parentPath: r.parentPath, parentDepth: r.depth - 1, chunkStart });
	}
	return out;
}
