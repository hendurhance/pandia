
export function reorderDestination(from: number, gap: number): number | null {
	if (gap === from || gap === from + 1) return null;
	return gap < from ? gap : gap - 1;
}
