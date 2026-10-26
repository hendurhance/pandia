// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { open as openInBrowser } from '@tauri-apps/plugin-shell';
import WhatsNewDialog from './WhatsNewDialog.svelte';
import { whatsNew } from '$lib/shell/state/whats-new.svelte';

const settings = vi.hoisted(() => new Map<string, unknown>());
vi.mock('$lib/util/persist', () => ({
	SETTINGS_FILE: 'pandia-settings.json',
	loadPersisted: async (_file: string, key: string) => settings.get(key),
	savePersisted: async (_file: string, key: string, value: unknown) => {
		settings.set(key, value);
	},
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.8' }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }));

async function openAfterSkipping() {
	settings.set('lastSeenRelease', '1.0.6');
	await whatsNew.init();
	return render(WhatsNewDialog, { props: { onClose: vi.fn() } });
}

beforeEach(() => settings.clear());
afterEach(() => cleanup());

describe("What's new dialog", () => {
	it('counts the running version as seen once it opens', async () => {
		await openAfterSkipping();
		await vi.waitFor(() => expect(settings.get('lastSeenRelease')).toBe('1.0.8'));
		expect(whatsNew.unseen).toEqual([]);
	});

	it('marks every version since the last one seen as new, and opens on the running one', async () => {
		const { getByRole, getByText } = await openAfterSkipping();
		await vi.waitFor(() => expect(whatsNew.unseen).toEqual([]));

		const rail = within(getByRole('navigation', { name: 'versions' })).getAllByRole('button');
		const marked = rail
			.filter((b) => within(b).queryByText('new'))
			.map((b) => b.textContent?.match(/\d+\.\d+\.\d+/)?.[0]);
		expect(marked).toEqual(['1.0.8', '1.0.7']);
		expect(getByRole('button', { current: true }).textContent).toContain('1.0.8');
		expect(getByText('Pandia 1.0.8')).toBeTruthy();
		expect(getByText("You're on 1.0.8")).toBeTruthy();
	});

	it('shows the notes of the version picked in the rail', async () => {
		const { getByRole, getByText } = await openAfterSkipping();
		await fireEvent.click(getByRole('button', { name: /1\.0\.7/ }));
		expect(getByText('Pandia 1.0.7')).toBeTruthy();
		expect(getByText('Grid view shows where newlines are')).toBeTruthy();
	});

	it('opens links in the browser', async () => {
		const { getByRole } = await openAfterSkipping();
		await fireEvent.click(getByRole('link', { name: 'the command-line guide' }));
		await fireEvent.click(getByRole('link', { name: /Full changelog/ }));
		expect(vi.mocked(openInBrowser).mock.calls).toEqual([
			['https://www.pandia.app/docs/command-line'],
			['https://www.pandia.app/changelog'],
		]);
	});
});
