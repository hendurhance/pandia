
export const EXPAND_ALL_MAX_BYTES = 50 * 1024 * 1024;

export const EXPAND_ALL_MAX_ROOT_ITEMS = 100_000;

export interface ExpandLimitsInput {
	
	summary: {
		sourceSize: number;
		rootChildCount: number | null;
	} | null;
	
	busy: boolean;
}

export function expandAllDisabled(input: ExpandLimitsInput): boolean {
	if (input.busy || !input.summary) return true;
	if (input.summary.sourceSize > EXPAND_ALL_MAX_BYTES) return true;
	if ((input.summary.rootChildCount ?? 0) > EXPAND_ALL_MAX_ROOT_ITEMS) return true;
	return false;
}

export function expandAllTitle(input: ExpandLimitsInput): string {
	if (input.busy) return 'busy…';
	if (!input.summary) return 'no doc loaded';
	if (input.summary.sourceSize > EXPAND_ALL_MAX_BYTES) {
		return `doc > ${Math.round(EXPAND_ALL_MAX_BYTES / 1024 / 1024)} MB — use expand-to-depth (v1.x)`;
	}
	if ((input.summary.rootChildCount ?? 0) > EXPAND_ALL_MAX_ROOT_ITEMS) {
		return `root > ${EXPAND_ALL_MAX_ROOT_ITEMS} items — use expand-to-depth (v1.x)`;
	}
	return 'expand all';
}
