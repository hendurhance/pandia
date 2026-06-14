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
