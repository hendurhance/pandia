import { describe, expect, it } from 'vitest';
import { THEMES, THEME_FAMILIES, familyOf } from './theme-palettes';

describe('theme-palettes consistency', () => {
	it('every id referenced by THEME_FAMILIES exists in THEMES', () => {
		const missing: string[] = [];
		for (const fam of THEME_FAMILIES) {
			if (fam.dark && !(fam.dark in THEMES)) missing.push(`${fam.name}.dark = ${fam.dark}`);
			if (fam.light && !(fam.light in THEMES)) missing.push(`${fam.name}.light = ${fam.light}`);
		}
		expect(missing).toEqual([]);
	});

	it('every theme in THEMES is reachable from some THEME_FAMILIES row', () => {
		const orphans: string[] = [];
		for (const id of Object.keys(THEMES)) {
			if (!familyOf(id)) orphans.push(id);
		}
		expect(orphans).toEqual([]);
	});

	it('theme ids match the key they are registered under', () => {
		for (const [key, theme] of Object.entries(THEMES)) {
			expect(theme.id, `key ${key} → theme.id`).toBe(key);
		}
	});
});
