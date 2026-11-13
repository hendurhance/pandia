// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { loadPersisted } from '$lib/util/persist';
import { DEFAULT_THEME } from '$lib/shell/logic/theme';
import { appearancePrefs } from './appearance-prefs.svelte';

vi.mock('$lib/util/persist', () => ({
	SETTINGS_FILE: 'settings.json',
	loadPersisted: vi.fn(),
	savePersisted: vi.fn(async () => {}),
}));

describe('appearancePrefs', () => {
	it('drops a custom font and size when imported settings use the defaults', async () => {
		const style = document.documentElement.style;
		vi.mocked(loadPersisted).mockResolvedValue({ fontFamily: 'Fira Code', fontSizeBase: 16 });
		await appearancePrefs.init();
		expect(style.getPropertyValue('--font-mono')).toContain('Fira Code');
		expect(style.getPropertyValue('--font-size-base')).toBe('16px');

		vi.mocked(loadPersisted).mockResolvedValue({ fontFamily: 'IBM Plex Mono', fontSizeBase: 13 });
		await appearancePrefs.reload();
		expect(style.getPropertyValue('--font-mono')).not.toContain('Fira Code');
		expect(style.getPropertyValue('--font-size-base')).not.toBe('16px');
	});

	it('uses the default theme and still applies the rest when the saved theme id is "constructor"', async () => {
		const style = document.documentElement.style;
		vi.mocked(loadPersisted).mockResolvedValue({ themeId: 'constructor', fontSizeBase: 15 });
		await appearancePrefs.reload();
		expect(appearancePrefs.themeId).toBe(DEFAULT_THEME.id);
		expect(style.getPropertyValue('--bg')).toBe(DEFAULT_THEME.colors.bg);
		expect(style.getPropertyValue('--font-size-base')).toBe('15px');
	});
});
