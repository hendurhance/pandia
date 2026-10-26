import type { Update } from '@tauri-apps/plugin-updater';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { isObject } from '$lib/util/guards';
import { UPDATE_FAILED } from '$lib/ipc/error-copy';

export const UPDATER_KEY = 'updater';

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
	private lastCheckAt = 0;
	private dismissedVersion: string | null = null;
	private loaded = false;

	update: Update | null = $state.raw(null);
	dialogOpen = $state(false);
	installing = $state(false);
	error: string | null = $state(null);

	get availableVersion(): string | null {
		return this.update?.version ?? null;
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		const p = sanitize(await loadPersisted(SETTINGS_FILE, UPDATER_KEY));
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
		} catch {
			// Endpoint unreachable / signature mismatch — stay silent.
		}
	}

	offer(update: Update): void {
		this.update = update;
		this.openDialog();
	}

	openDialog(): void {
		this.error = null;
		this.dialogOpen = true;
	}

	later(): void {
		this.dialogOpen = false;
	}

	async skip(): Promise<void> {
		if (!this.update) return;
		await this.load();
		this.dismissedVersion = this.update.version;
		this.update = null;
		this.dialogOpen = false;
		await this.persist();
	}

	async install(): Promise<void> {
		if (!this.update || this.installing) return;
		this.installing = true;
		this.error = null;
		try {
			await this.update.downloadAndInstall();
			await relaunch();
		} catch {
			// Keep the update on offer so the user can retry.
			this.error = UPDATE_FAILED;
		} finally {
			this.installing = false;
		}
	}

	private async persist(): Promise<void> {
		await savePersisted(SETTINGS_FILE, UPDATER_KEY, {
			lastCheckAt: this.lastCheckAt,
			dismissedVersion: this.dismissedVersion,
		} satisfies Persisted);
	}
}

export const updateCheck = new UpdateCheck();
