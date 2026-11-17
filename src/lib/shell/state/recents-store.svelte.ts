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
	private early: ((list: RecentFile[]) => RecentFile[])[] = [];

	protected async load(): Promise<void> {
		const raw = await loadPersisted<RecentFile[]>(STORE_FILE, STORE_KEY);
		const early = this.early.splice(0);
		this.list = early.reduce((list, change) => change(list), sanitize(raw));
		if (early.length > 0) void this.persist();
	}

	add(path: string, name?: string, size?: number): void {
		const now = new Date().toISOString();
		const display = name ?? basename(path);
		this.change((list) => {
			const existing = list.find((e) => e.path === path);
			const pinned = existing?.pinned ?? false; // preserve pin across re-opens
			const filtered = list.filter((e) => e.path !== path);
			const next = [{ path, name: display, openedAt: now, size, pinned }, ...filtered];
			const evicted = new Set(next.filter((e) => !e.pinned).slice(MAX_ENTRIES));
			return next.filter((e) => !evicted.has(e));
		});
	}

	remove(path: string): void {
		this.change((list) => list.filter((e) => e.path !== path));
	}

	clear(): void {
		this.change((list) => list.filter((e) => e.pinned));
	}

	togglePin(path: string): void {
		this.change((list) => list.map((e) => (e.path === path ? { ...e, pinned: !e.pinned } : e)));
	}

	private change(apply: (list: RecentFile[]) => RecentFile[]): void {
		this.list = apply(this.list);
		if (this.loaded) void this.persist();
		else this.early.push(apply);
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
