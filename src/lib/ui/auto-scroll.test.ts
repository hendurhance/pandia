import { describe, expect, it } from 'vitest';
import { edgeStep } from './auto-scroll';

describe('edgeStep', () => {
	it('clamps small depths up to the floor (2 px/frame)', () => {
		expect(edgeStep(0, 40, 16)).toBe(2);
		expect(edgeStep(1, 40, 16)).toBe(2);
	});

	it('scales linearly through the edge zone', () => {
		expect(edgeStep(40, 40, 16)).toBe(16);
		const mid = edgeStep(20, 40, 16);
		expect(mid).toBeGreaterThan(2);
		expect(mid).toBeLessThan(16);
	});

	it('caps at maxStep past the edge zone', () => {
		expect(edgeStep(80, 40, 16)).toBe(16);
		expect(edgeStep(9999, 40, 16)).toBe(16);
	});

	it('respects custom edgeZone + maxStep', () => {
		expect(edgeStep(36, 36, 14)).toBe(14);
		expect(edgeStep(18, 36, 14)).toBe(7);
	});
});
