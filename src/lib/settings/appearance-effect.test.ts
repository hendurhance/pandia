// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { APPEARANCE_CHANGE_EVENT } from '$lib/shell/logic/theme';
import { appearancePrefs } from './state/appearance-prefs.svelte';
import AppearancePanel from './AppearancePanel.svelte';
import Layout from '../../routes/+layout.svelte';

vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn(), writeText: vi.fn() }));

window.matchMedia ??= (() => ({
	matches: true,
	addEventListener: () => {},
	removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

const settle = () => new Promise((r) => setTimeout(r, 0));

async function changesDuring(act: () => Promise<unknown>): Promise<number> {
	let changes = 0;
	const count = () => changes++;
	window.addEventListener(APPEARANCE_CHANGE_EVENT, count);
	await act();
	await settle();
	window.removeEventListener(APPEARANCE_CHANGE_EVENT, count);
	return changes;
}

describe('applying an appearance change', () => {
	it('happens once while the Appearance panel is open', async () => {
		await appearancePrefs.init();
		const { getByText } = render(AppearancePanel);
		await settle();

		expect(await changesDuring(() => fireEvent.click(getByText('Compact')))).toBe(1);
		expect(appearancePrefs.density).toBe('compact');
		cleanup();
	});

	it('happens once under the root layout', async () => {
		render(Layout, {
			props: { children: createRawSnippet(() => ({ render: () => '<div></div>' })) },
		});
		await settle();

		expect(await changesDuring(() => appearancePrefs.setDensity('comfortable'))).toBe(1);
		cleanup();
	});
});
