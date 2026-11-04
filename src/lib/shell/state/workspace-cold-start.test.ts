// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { stat } from '@tauri-apps/plugin-fs';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { Workspace } from './workspace.svelte';

const settings = vi.hoisted(() => ({ release: [] as (() => void)[] }));

vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(
		(_file: string, key: string) =>
			new Promise((resolve) =>
				settings.release.push(() =>
					resolve(key === 'behavior' ? { warnLargeFileOpen: false } : undefined),
				),
			),
	),
	savePersisted: vi.fn(async () => {}),
}));
vi.mock('$lib/ipc/client', () => ({ ipc: {} }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn() }));

const LARGE = 300 * 1024 * 1024;

describe('large-file warning on a cold start', () => {
	it('follows the saved "warn before opening large files" setting for a file handed in at launch', async () => {
		vi.mocked(stat).mockResolvedValue({ size: LARGE } as never);
		const confirmLargeFile = vi.fn(async () => true);
		const ws = new Workspace({ confirmLargeFile, confirmUnsaved: async () => 'cancel' });

		void behaviorPrefs.init();
		const opening = ws.open({ kind: 'file', path: '/w/big.json' });
		await new Promise((r) => setTimeout(r, 0));
		for (const release of settings.release) release();
		await behaviorPrefs.init();
		await opening;

		expect(behaviorPrefs.warnLargeFileOpen).toBe(false);
		expect(
			confirmLargeFile,
			'asked about a large file although the user turned that off',
		).not.toHaveBeenCalled();
	});
});
