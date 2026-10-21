// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import UpdateDialog from './UpdateDialog.svelte';
import { updateCheck } from '$lib/shell/state/update-check.svelte';
import { whatsNew } from '$lib/shell/state/whats-new.svelte';

const events = vi.hoisted(() => [] as string[]);
const settings = vi.hoisted(() => new Map<string, unknown>());
vi.mock('$lib/util/persist', () => ({
	SETTINGS_FILE: 'pandia-settings.json',
	loadPersisted: async (_file: string, key: string) => settings.get(key),
	savePersisted: async (_file: string, key: string, value: unknown) => {
		events.push(`save ${key}`);
		settings.set(key, value);
	},
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.8' }));
vi.mock('@tauri-apps/plugin-process', () => ({
	relaunch: vi.fn(async () => {
		events.push('relaunch');
	}),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }));

const NOTES = [
	'### New',
	'',
	'- **Open `a.json` now**: See [the guide](https://www.pandia.app/docs).',
	'',
	'### Fixed',
	'',
	'- **<img src=x onerror="alert(1)">**',
].join('\n');

function fakeUpdate(
	body: string | undefined,
	install = async () => {
		events.push('install');
	},
): Update {
	return {
		version: '1.0.9',
		currentVersion: '1.0.8',
		body,
		downloadAndInstall: vi.fn(install),
	} as unknown as Update;
}

async function offer(update = fakeUpdate(NOTES)) {
	settings.set('lastSeenRelease', '1.0.8');
	await whatsNew.init();
	updateCheck.offer(update);
	return render(UpdateDialog, { props: { update } });
}

beforeEach(() => {
	settings.clear();
	events.length = 0;
	vi.mocked(relaunch).mockClear();
});
afterEach(() => cleanup());

describe('Update dialog', () => {
	it('shows the new version, the version you are on, and its notes as text', async () => {
		const { getByText, getByRole, container } = await offer();
		expect(getByText('Pandia 1.0.9 is ready to install')).toBeTruthy();
		expect(getByText(/^You're on 1\.0\.8\./)).toBeTruthy();
		expect(getByText(/^Open/).textContent).toBe('Open a.json now');
		expect(getByRole('link', { name: 'the guide' })).toBeTruthy();
		expect(getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
		expect(container.querySelector('img')).toBeNull();
	});

	it('says so when the update carries notes it cannot read', async () => {
		const { getByText, getByRole } = await offer(
			fakeUpdate('See assets to download and install this version.'),
		);
		expect(getByText('No release notes for this version.')).toBeTruthy();
		expect(getByRole('link', { name: /Full changelog/ })).toBeTruthy();
	});

	it('Skip this version remembers the version and hides the update', async () => {
		const { getByRole } = await offer();
		await fireEvent.click(getByRole('button', { name: 'Skip this version' }));
		await vi.waitFor(() =>
			expect(settings.get('updater')).toMatchObject({ dismissedVersion: '1.0.9' }),
		);
		expect(updateCheck.availableVersion).toBeNull();
		expect(updateCheck.dialogOpen).toBe(false);
	});

	it('Later closes and keeps the update on offer', async () => {
		const { getByRole } = await offer();
		await fireEvent.click(getByRole('button', { name: 'Later' }));
		expect(updateCheck.dialogOpen).toBe(false);
		expect(updateCheck.availableVersion).toBe('1.0.9');
		expect(settings.has('updater')).toBe(false);
	});

	it('Install and restart counts the notes as seen, then installs and relaunches', async () => {
		const { getByRole } = await offer();
		await fireEvent.click(getByRole('button', { name: 'Install and restart' }));
		await vi.waitFor(() => expect(events).toContain('relaunch'));
		expect(events).toEqual(['save lastSeenRelease', 'install', 'relaunch']);
		expect(settings.get('lastSeenRelease')).toBe('1.0.9');
	});

	it('reads "Downloading…" and cannot be pressed again while it installs', async () => {
		let finish = () => {};
		const pending = new Promise<void>((resolve) => (finish = resolve));
		const { getByRole, findByRole } = await offer(fakeUpdate(NOTES, () => pending));
		await fireEvent.click(getByRole('button', { name: 'Install and restart' }));
		const busy = await findByRole('button', { name: 'Downloading…' });
		expect((busy as HTMLButtonElement).disabled).toBe(true);
		finish();
		await vi.waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
	});

	it('says plainly when the install fails, and keeps the update on offer', async () => {
		const failing = fakeUpdate(NOTES, async () => {
			throw 'error sending request for url (https://github.com/hendurhance/pandia/releases)';
		});
		const { getByRole, findByRole } = await offer(failing);
		await fireEvent.click(getByRole('button', { name: 'Install and restart' }));
		expect((await findByRole('alert')).textContent).toBe(
			"Couldn't download or install the update. Check your connection and try again, or download it from pandia.app.",
		);
		expect(relaunch).not.toHaveBeenCalled();
		expect(updateCheck.availableVersion).toBe('1.0.9');
		expect(
			(getByRole('button', { name: 'Install and restart' }) as HTMLButtonElement).disabled,
		).toBe(false);
	});
});
