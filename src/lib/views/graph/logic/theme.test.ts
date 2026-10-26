import { describe, expect, it } from 'vitest';
import { hueColor, type GraphTheme } from './theme';

const theme: GraphTheme = {
	bg: '#1b1b1d',
	bgElev: '#212124',
	bgElev2: '#27272a',
	bgElev3: '#2f2f33',
	rule: '#2c2c30',
	rule2: '#3a3a3f',
	text: '#e6e6e9',
	textDim: '#9b9ba2',
	textFaint: '#5c5c64',
	textGhost: '#3a3a40',
	accent: '#ff6a3a',
	accent2: '#e0a53c',
	syntaxString: '#e0a53c',
	syntaxNumber: '#7fb069',
	syntaxBoolean: '#9c6bff',
	syntaxNull: '#6a6a72',
	syntaxPunct: '#6a6a72',
	monoFamily: 'monospace',
	isLight: false,
};

describe('hueColor', () => {
	it('ramps from the accent to the dim text colour across the four hues', () => {
		expect([0, 1, 2, 3].map((h) => hueColor(theme, h))).toEqual([
			'#ff6a3a',
			'#dc7b5e',
			'#b98c83',
			'#9b9ba2',
		]);
	});

	it('wraps hues beyond the ramp', () => {
		expect(hueColor(theme, 5)).toBe(hueColor(theme, 1));
	});

	it('never reuses a value-type colour', () => {
		const valueColors = [
			theme.syntaxString,
			theme.syntaxNumber,
			theme.syntaxBoolean,
			theme.accent2,
		];
		for (let h = 0; h < 4; h++) expect(valueColors).not.toContain(hueColor(theme, h));
	});
});
