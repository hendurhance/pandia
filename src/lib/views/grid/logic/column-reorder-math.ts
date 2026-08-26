export function gapForX(
	contentX: number,
	offsets: ArrayLike<number>,
	widths: ArrayLike<number>,
): number {
	const n = Math.min(offsets.length, widths.length);
	let g = 0;
	for (let i = 0; i < n; i++) {
		const off = offsets[i];
		const w = widths[i];
		if (off === undefined || w === undefined) break;
		if (contentX > off + w / 2) g = i + 1;
		else break;
	}
	return g;
}

export function contentXFromClient(
	clientX: number,
	headerLeftPx: number,
	scrollLeft: number,
): number {
	return clientX - headerLeftPx + scrollLeft;
}
