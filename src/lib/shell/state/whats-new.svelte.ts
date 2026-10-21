import { getVersion } from '@tauri-apps/api/app';
import { releases } from '../logic/releases';
import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { compareVersions, unseenVersions } from '../logic/release-notes';
import { UPDATER_KEY } from './update-check.svelte';

const STORE_KEY = 'lastSeenRelease';

class WhatsNew {
	running: string | null = $state(null);
	unseen: readonly string[] = $state.raw([]);
	private lastSeen: string | null = null;

	async init(): Promise<void> {
		const [running, saved, updater] = await Promise.all([
			getVersion(),
			loadPersisted(SETTINGS_FILE, STORE_KEY),
			loadPersisted(SETTINGS_FILE, UPDATER_KEY),
		]);
		this.running = running;
		this.lastSeen = typeof saved === 'string' ? saved : null;
		// The updater's record means an older Pandia ran here before.
		const existingUser = updater !== undefined;
		if (this.lastSeen === null && !existingUser) return this.markSeen(running);
		this.unseen = unseenVersions(
			releases.map((r) => r.version),
			{ running, lastSeen: this.lastSeen, existingUser },
		);
	}

	async markSeen(version: string): Promise<void> {
		this.unseen = [];
		if (this.lastSeen !== null && compareVersions(this.lastSeen, version) >= 0) return;
		this.lastSeen = version;
		await savePersisted(SETTINGS_FILE, STORE_KEY, version);
	}
}

export const whatsNew = new WhatsNew();
