export const DEFAULT_ROW_H = 22;

export const OVERSCAN = 8;

export function buildOffsets(
	rowCount: number,
	heightAt: (i: number) => number,
	buf: Float64Array,
	fastPath: boolean = false,
	defaultH: number = DEFAULT_ROW_H,
): { view: Float64Array; buf: Float64Array } {
	let b = buf;
	if (b.length < rowCount + 1) {
		b = new Float64Array(Math.max(rowCount + 1, b.length * 2));
	}
	b[0] = 0;
	if (fastPath) {
		for (let i = 0; i < rowCount; i++) b[i + 1] = (i + 1) * defaultH;
	} else {
		for (let i = 0; i < rowCount; i++) b[i + 1] = b[i] + heightAt(i);
	}
	return { view: b.subarray(0, rowCount + 1), buf: b };
}

export function indexAtOffset(offsets: ArrayLike<number>, rowCount: number, y: number): number {
	let lo = 0;
	let hi = rowCount;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (offsets[mid + 1] <= y) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

export function visibleWindow(
	offsets: ArrayLike<number>,
	rowCount: number,
	scrollTop: number,
	viewportHeight: number,
	overscan: number = OVERSCAN,
): { start: number; end: number } {
	const start = Math.max(0, indexAtOffset(offsets, rowCount, scrollTop) - overscan);
	const limit = scrollTop + viewportHeight;
	let i = start;
	while (i < rowCount && offsets[i] < limit) i++;
	return { start, end: Math.min(rowCount, i + overscan) };
}

export function fixedWindow(
	scrollTop: number,
	viewportHeight: number,
	rowCount: number,
	rowHeight: number,
	overscan: number = OVERSCAN,
): { start: number; end: number } {
	const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
	const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
	return { start, end };
}
