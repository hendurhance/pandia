// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { loadPersisted } from '$lib/util/persist';
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
});
