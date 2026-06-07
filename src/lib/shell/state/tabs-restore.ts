import { loadPersisted, savePersisted, TABS_FILE } from '$lib/util/persist';
import { isObject } from '$lib/util/guards';

const STORE_KEY = 'open-tabs';

interface Persisted {
	paths: string[];
	activeIndex: number;
}

function sanitize(raw: unknown): Persisted {
	const fallback: Persisted = { paths: [], activeIndex: -1 };
	if (!isObject(raw)) return fallback;
	const paths = Array.isArray(raw.paths)
		? raw.paths.filter((p): p is string => typeof p === 'string')
		: [];
	let activeIndex = typeof raw.activeIndex === 'number' ? Math.floor(raw.activeIndex) : -1;
	if (activeIndex < -1 || activeIndex >= paths.length) activeIndex = -1;
	return { paths, activeIndex };
}

export async function loadOpenTabs(): Promise<Persisted> {
	return sanitize(await loadPersisted<Persisted>(TABS_FILE, STORE_KEY));
}

export async function saveOpenTabs(paths: string[], activeIndex: number): Promise<void> {
	const safeIndex = activeIndex >= 0 && activeIndex < paths.length ? activeIndex : -1;
	await savePersisted(TABS_FILE, STORE_KEY, {
		paths,
		activeIndex: safeIndex,
	} satisfies Persisted);
}
