import { describe, expect, it } from 'vitest';
import { contrastRatio, mixHex, withAlpha } from './color';

describe('contrastRatio', () => {
	it('matches the WCAG reference values', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
		expect(contrastRatio('#757575', '#ffffff')).toBeCloseTo(4.6, 1);
		expect(contrastRatio('#ffffff', '#757575')).toBeCloseTo(4.6, 1);
		expect(contrastRatio('#1b1b1d', '#1b1b1d')).toBe(1);
	});
});

describe('mixHex', () => {
	it('blends linearly between the two colours', () => {
		expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
		expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
		expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
	});
});

describe('withAlpha', () => {
	it('turns a hex colour into a translucent rgba', () => {
		expect(withAlpha('#E65155', 0.16)).toBe('rgba(230, 81, 85, 0.16)');
	});
});
