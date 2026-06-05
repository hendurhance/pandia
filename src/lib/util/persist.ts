import { load, type Store } from '@tauri-apps/plugin-store';

export const SETTINGS_FILE = 'pandia-settings.json';

export const RECENTS_FILE = 'pandia-recents.json';

export const COMMAND_USAGE_FILE = 'pandia-command-usage.json';

export const GRID_WIDTHS_FILE = 'pandia-grid-widths.json';

export const GRID_ORDER_FILE = 'pandia-grid-order.json';

export const TYPEGEN_FILE = 'pandia-typegen.json';

export const PERSISTED_FILES = [
	SETTINGS_FILE,
	RECENTS_FILE,
	COMMAND_USAGE_FILE,
	GRID_WIDTHS_FILE,
	GRID_ORDER_FILE,
	TYPEGEN_FILE,
] as const;

const handles = new Map<string, Promise<Store>>();

function getStore(file: string): Promise<Store> {
	let p = handles.get(file);
	if (!p) {
		p = load(file, { autoSave: false, defaults: {} });
		handles.set(file, p);
	}
	return p;
}

export async function loadPersisted<T>(file: string, key: string): Promise<T | undefined> {
	const store = await getStore(file);
	return (await store.get<T>(key)) as T | undefined;
}

export async function savePersisted(file: string, key: string, value: unknown): Promise<void> {
	try {
		const store = await getStore(file);
		await store.set(key, value);
		await store.save();
	} catch {
		
	}
}

const EXPORTABLE_FILES: readonly string[] = [SETTINGS_FILE, TYPEGEN_FILE];

export interface SettingsBundle {
	$kind: 'pandia-settings';
	version: 1;
	exportedAt: string;
	files: Record<string, Record<string, unknown>>;
}

export async function exportSettings(): Promise<SettingsBundle> {
	const files: Record<string, Record<string, unknown>> = {};
	for (const file of EXPORTABLE_FILES) {
		const store = await getStore(file);
		const entries = await store.entries();
		const obj: Record<string, unknown> = {};
		for (const [k, v] of entries) obj[k] = v;
		files[file] = obj;
	}
	return {
		$kind: 'pandia-settings',
		version: 1,
		exportedAt: new Date().toISOString(),
		files,
	};
}

export async function importSettings(raw: unknown): Promise<void> {
	if (!raw || typeof raw !== 'object') throw new Error('settings bundle is not an object');
	const bundle = raw as Partial<SettingsBundle>;
	if (bundle.$kind !== 'pandia-settings') throw new Error('not a Pandia settings bundle');
	if (bundle.version !== 1) throw new Error(`unsupported bundle version: ${String(bundle.version)}`);
	if (!bundle.files || typeof bundle.files !== 'object') throw new Error('bundle is missing files');
	for (const [file, keys] of Object.entries(bundle.files)) {
		if (!EXPORTABLE_FILES.includes(file)) continue;
		if (!keys || typeof keys !== 'object') continue;
		const store = await getStore(file);
		for (const [k, v] of Object.entries(keys)) await store.set(k, v);
		await store.save();
	}
}
