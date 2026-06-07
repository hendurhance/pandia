import type { Update } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';
import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { isObject } from '$lib/util/guards';

const STORE_KEY = 'updater';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Persisted {
	lastCheckAt: number;
	dismissedVersion: string | null;
}

function sanitize(raw: unknown): Persisted {
	if (!isObject(raw)) return { lastCheckAt: 0, dismissedVersion: null };
	return {
		lastCheckAt: typeof raw.lastCheckAt === 'number' ? raw.lastCheckAt : 0,
		dismissedVersion: typeof raw.dismissedVersion === 'string' ? raw.dismissedVersion : null,
	};
}

class UpdateCheck {
	private update: Update | null = null;
	private lastCheckAt = 0;
	private dismissedVersion: string | null = null;
	private loaded = false;

	availableVersion: string | null = $state(null);

	private async load(): Promise<void> {
		if (this.loaded) return;
		const p = sanitize(await loadPersisted(SETTINGS_FILE, STORE_KEY));
		this.lastCheckAt = p.lastCheckAt;
		this.dismissedVersion = p.dismissedVersion;
		this.loaded = true;
	}

	async silentCheck(): Promise<void> {
		await this.load();
		const now = Date.now();
		if (now - this.lastCheckAt < CHECK_INTERVAL_MS) return;
		try {
			const upd = await check();
			this.lastCheckAt = now;
			await this.persist();
			if (!upd) return;
			if (upd.version === this.dismissedVersion) return;
			this.update = upd;
			this.availableVersion = upd.version;
		} catch {
			// Endpoint unreachable / signature mismatch — stay silent.
		}
	}

	async promptAndInstall(): Promise<void> {
		if (!this.update || !this.availableVersion) return;
		const yes = await ask(
			`Pandia ${this.availableVersion} is available. Download and install now?`,
			{ title: 'Update available' },
		).catch(() => false);
		if (yes) {
			try {
				await this.update.downloadAndInstall();
				await relaunch();
			} catch {
				// Leave the pill so the user can retry.
			}
			return;
		}
		this.dismissedVersion = this.availableVersion;
		this.availableVersion = null;
		this.update = null;
		await this.persist();
	}

	private async persist(): Promise<void> {
		await savePersisted(SETTINGS_FILE, STORE_KEY, {
			lastCheckAt: this.lastCheckAt,
			dismissedVersion: this.dismissedVersion,
		} satisfies Persisted);
	}
}

export const updateCheck = new UpdateCheck();
