// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import StatusBar from './StatusBar.svelte';
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

async function launch() {
	await whatsNew.init();
	const onWhatsNew = vi.fn();
	return { ...render(StatusBar, { props: { status: null, onWhatsNew } }), onWhatsNew };
}

beforeEach(() => settings.clear());
afterEach(() => cleanup());

describe("status bar — what's new", () => {
	it('offers the notes after an update from outside the app', async () => {
		settings.set('lastSeenRelease', '1.0.7');
		const { getByText, onWhatsNew } = await launch();
		await fireEvent.click(getByText("what's new in 1.0.8"));
		expect(onWhatsNew).toHaveBeenCalledOnce();
	});

	it('offers them to an existing user who has never seen notes', async () => {
		settings.set('updater', { lastCheckAt: 1, dismissedVersion: null });
		const { getByText } = await launch();
		expect(getByText("what's new in 1.0.8")).toBeTruthy();
	});

	it('shows nothing once this version has been seen', async () => {
		settings.set('lastSeenRelease', '1.0.8');
		const { queryByText } = await launch();
		expect(queryByText(/what's new/)).toBeNull();
	});

	it('shows nothing on a fresh install, and counts this version as seen', async () => {
		const { queryByText } = await launch();
		expect(queryByText(/what's new/)).toBeNull();
		expect(settings.get('lastSeenRelease')).toBe('1.0.8');
	});
});
