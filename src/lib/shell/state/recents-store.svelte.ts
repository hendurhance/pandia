import { loadPersisted, savePersisted, RECENTS_FILE } from '$lib/util/persist';
import { PersistedStore } from '$lib/util/persisted-store.svelte';
import { basename } from '$lib/util/path';

const STORE_FILE = RECENTS_FILE;
const STORE_KEY = 'recents';
const MAX_ENTRIES = 50;

export interface RecentFile {
	path: string;
	name: string;
	openedAt: string; // ISO timestamp
	size?: number; // source bytes at open time (optional — older entries lack it)

	pinned?: boolean;
}

function sanitize(raw: unknown): RecentFile[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter(
			(e): e is RecentFile =>
				e &&
				typeof e.path === 'string' &&
				typeof e.name === 'string' &&
				typeof e.openedAt === 'string',
		)
		.map((e) => ({
			path: e.path,
			name: e.name,
			openedAt: e.openedAt,
			size: typeof e.size === 'number' ? e.size : undefined,
			pinned: e.pinned === true,
		}));
}

class RecentsStore extends PersistedStore {
	list: RecentFile[] = $state([]);

	protected async load(): Promise<void> {
		const raw = await loadPersisted<RecentFile[]>(STORE_FILE, STORE_KEY);
		this.list = sanitize(raw);
	}

	add(path: string, name?: string, size?: number): void {
		const now = new Date().toISOString();
		const display = name ?? basename(path);
		const existing = this.list.find((e) => e.path === path);
		const pinned = existing?.pinned ?? false; // preserve pin across re-opens
		const filtered = this.list.filter((e) => e.path !== path);
		const next = [{ path, name: display, openedAt: now, size, pinned }, ...filtered];
		const pinnedCount = next.filter((e) => e.pinned).length;
		const cap = Math.max(MAX_ENTRIES, pinnedCount);
		this.list = next.slice(0, cap);
		void this.persist();
	}

	remove(path: string): void {
		this.list = this.list.filter((e) => e.path !== path);
		void this.persist();
	}

	clear(): void {
		this.list = this.list.filter((e) => e.pinned);
		void this.persist();
	}

	togglePin(path: string): void {
		this.list = this.list.map((e) => (e.path === path ? { ...e, pinned: !e.pinned } : e));
		void this.persist();
	}

	private persist(): Promise<void> {
		return savePersisted(STORE_FILE, STORE_KEY, this.list);
	}
}

export const recentsStore = new RecentsStore();

export function addRecent(path: string, name?: string, size?: number): void {
	recentsStore.add(path, name, size);
}
export function removeRecent(path: string): void {
	recentsStore.remove(path);
}
export function clearRecents(): void {
	recentsStore.clear();
}
export function togglePin(path: string): void {
	recentsStore.togglePin(path);
}
