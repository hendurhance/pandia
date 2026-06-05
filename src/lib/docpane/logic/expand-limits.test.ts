import { describe, expect, it } from 'vitest';
import {
	EXPAND_ALL_MAX_BYTES,
	EXPAND_ALL_MAX_ROOT_ITEMS,
	expandAllDisabled,
	expandAllTitle,
} from './expand-limits';

describe('expandAllDisabled', () => {
	it('disables when no doc is loaded', () => {
		expect(expandAllDisabled({ summary: null, busy: false })).toBe(true);
	});

	it('disables while busy', () => {
		expect(
			expandAllDisabled({
				summary: { sourceSize: 1000, rootChildCount: 10 },
				busy: true,
			}),
		).toBe(true);
	});

	it('disables when sourceSize exceeds the byte threshold', () => {
		expect(
			expandAllDisabled({
				summary: { sourceSize: EXPAND_ALL_MAX_BYTES + 1, rootChildCount: 10 },
				busy: false,
			}),
		).toBe(true);
	});

	it('disables when rootChildCount exceeds the item threshold', () => {
		expect(
			expandAllDisabled({
				summary: { sourceSize: 100, rootChildCount: EXPAND_ALL_MAX_ROOT_ITEMS + 1 },
				busy: false,
			}),
		).toBe(true);
	});

	it('enables for normal-sized docs', () => {
		expect(
			expandAllDisabled({
				summary: { sourceSize: 100_000, rootChildCount: 50 },
				busy: false,
			}),
		).toBe(false);
	});

	it('treats null rootChildCount as 0 (allowed)', () => {
		expect(
			expandAllDisabled({
				summary: { sourceSize: 100, rootChildCount: null },
				busy: false,
			}),
		).toBe(false);
	});

	it('at exactly the threshold, still enabled (strict-greater check)', () => {
		expect(
			expandAllDisabled({
				summary: {
					sourceSize: EXPAND_ALL_MAX_BYTES,
					rootChildCount: EXPAND_ALL_MAX_ROOT_ITEMS,
				},
				busy: false,
			}),
		).toBe(false);
	});
});

describe('expandAllTitle', () => {
	it('says "busy…" when busy', () => {
		expect(
			expandAllTitle({
				summary: { sourceSize: 100, rootChildCount: 1 },
				busy: true,
			}),
		).toBe('busy…');
	});

	it('says "no doc loaded" when no summary', () => {
		expect(expandAllTitle({ summary: null, busy: false })).toBe('no doc loaded');
	});

	it('explains the byte cap when over', () => {
		const title = expandAllTitle({
			summary: { sourceSize: EXPAND_ALL_MAX_BYTES + 1, rootChildCount: 0 },
			busy: false,
		});
		expect(title).toContain('MB');
		expect(title).toContain('v1.x');
	});

	it('explains the item cap when over', () => {
		const title = expandAllTitle({
			summary: { sourceSize: 100, rootChildCount: EXPAND_ALL_MAX_ROOT_ITEMS + 1 },
			busy: false,
		});
		expect(title).toContain(String(EXPAND_ALL_MAX_ROOT_ITEMS));
		expect(title).toContain('v1.x');
	});

	it('says plain "expand all" when within both caps', () => {
		expect(
			expandAllTitle({
				summary: { sourceSize: 100, rootChildCount: 5 },
				busy: false,
			}),
		).toBe('expand all');
	});

	it('busy takes priority over caps', () => {
		expect(
			expandAllTitle({
				summary: {
					sourceSize: EXPAND_ALL_MAX_BYTES * 10,
					rootChildCount: EXPAND_ALL_MAX_ROOT_ITEMS * 10,
				},
				busy: true,
			}),
		).toBe('busy…');
	});
});
