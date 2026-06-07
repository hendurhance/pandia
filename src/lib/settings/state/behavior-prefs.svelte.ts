import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { PersistedStore } from '$lib/util/persisted-store.svelte';
import { isObject } from '$lib/util/guards';

const STORE_KEY = 'behavior';

export const SCHEMA_DEBOUNCE_DEFAULT = 500;

export const SCHEMA_DEBOUNCE_IMMEDIATE = 0;
export const SCHEMA_DEBOUNCE_MANUAL = -1;
export const SCHEMA_DEBOUNCE_MAX = 5000;

export const AUTO_SAVE_IDLE_DEFAULT = 1500;
export const AUTO_SAVE_IDLE_MIN = 250;
export const AUTO_SAVE_IDLE_MAX = 10_000;

interface Persisted {
	schemaDebounceMs: number;
	autoRepairOnPaste: boolean;
	autoSaveOnIdle: boolean;
	autoSaveIdleMs: number;
	warnLargeFileOpen: boolean;
	restoreTabsOnLaunch: boolean;
}

function sanitize(raw: unknown): Persisted {
	const fallback: Persisted = {
		schemaDebounceMs: SCHEMA_DEBOUNCE_DEFAULT,
		autoRepairOnPaste: true,
		autoSaveOnIdle: false,
		autoSaveIdleMs: AUTO_SAVE_IDLE_DEFAULT,
		warnLargeFileOpen: true,
		restoreTabsOnLaunch: true,
	};
	if (!isObject(raw)) return fallback;
	const r = raw;
	let ms =
		typeof r.schemaDebounceMs === 'number'
			? Math.round(r.schemaDebounceMs)
			: SCHEMA_DEBOUNCE_DEFAULT;
	if (ms < SCHEMA_DEBOUNCE_MANUAL) ms = SCHEMA_DEBOUNCE_MANUAL;
	if (ms > SCHEMA_DEBOUNCE_MAX) ms = SCHEMA_DEBOUNCE_MAX;
	let idle =
		typeof r.autoSaveIdleMs === 'number' ? Math.round(r.autoSaveIdleMs) : AUTO_SAVE_IDLE_DEFAULT;
	if (idle < AUTO_SAVE_IDLE_MIN) idle = AUTO_SAVE_IDLE_MIN;
	if (idle > AUTO_SAVE_IDLE_MAX) idle = AUTO_SAVE_IDLE_MAX;
	return {
		schemaDebounceMs: ms,
		autoRepairOnPaste: typeof r.autoRepairOnPaste === 'boolean' ? r.autoRepairOnPaste : true,
		autoSaveOnIdle: typeof r.autoSaveOnIdle === 'boolean' ? r.autoSaveOnIdle : false,
		autoSaveIdleMs: idle,
		warnLargeFileOpen: typeof r.warnLargeFileOpen === 'boolean' ? r.warnLargeFileOpen : true,
		restoreTabsOnLaunch:
			typeof r.restoreTabsOnLaunch === 'boolean' ? r.restoreTabsOnLaunch : true,
	};
}

class BehaviorPrefs extends PersistedStore {
	schemaDebounceMs: number = $state(SCHEMA_DEBOUNCE_DEFAULT);
	autoRepairOnPaste: boolean = $state(true);
	autoSaveOnIdle: boolean = $state(false);
	autoSaveIdleMs: number = $state(AUTO_SAVE_IDLE_DEFAULT);
	warnLargeFileOpen: boolean = $state(true);
	restoreTabsOnLaunch: boolean = $state(true);

	protected async load(): Promise<void> {
		const p = sanitize(await loadPersisted<Persisted>(SETTINGS_FILE, STORE_KEY));
		this.schemaDebounceMs = p.schemaDebounceMs;
		this.autoRepairOnPaste = p.autoRepairOnPaste;
		this.autoSaveOnIdle = p.autoSaveOnIdle;
		this.autoSaveIdleMs = p.autoSaveIdleMs;
		this.warnLargeFileOpen = p.warnLargeFileOpen;
		this.restoreTabsOnLaunch = p.restoreTabsOnLaunch;
	}

	private async persist(): Promise<void> {
		await savePersisted(SETTINGS_FILE, STORE_KEY, {
			schemaDebounceMs: this.schemaDebounceMs,
			autoRepairOnPaste: this.autoRepairOnPaste,
			autoSaveOnIdle: this.autoSaveOnIdle,
			autoSaveIdleMs: this.autoSaveIdleMs,
			warnLargeFileOpen: this.warnLargeFileOpen,
			restoreTabsOnLaunch: this.restoreTabsOnLaunch,
		} satisfies Persisted);
	}

	async setSchemaDebounce(ms: number): Promise<void> {
		let v = Math.round(ms);
		if (v < SCHEMA_DEBOUNCE_MANUAL) v = SCHEMA_DEBOUNCE_MANUAL;
		if (v > SCHEMA_DEBOUNCE_MAX) v = SCHEMA_DEBOUNCE_MAX;
		if (v === this.schemaDebounceMs) return;
		this.schemaDebounceMs = v;
		await this.persist();
	}

	async setAutoRepairOnPaste(on: boolean): Promise<void> {
		if (this.autoRepairOnPaste === on) return;
		this.autoRepairOnPaste = on;
		await this.persist();
	}

	async setAutoSaveOnIdle(on: boolean): Promise<void> {
		if (this.autoSaveOnIdle === on) return;
		this.autoSaveOnIdle = on;
		await this.persist();
	}

	async setAutoSaveIdleMs(ms: number): Promise<void> {
		let v = Math.round(ms);
		if (v < AUTO_SAVE_IDLE_MIN) v = AUTO_SAVE_IDLE_MIN;
		if (v > AUTO_SAVE_IDLE_MAX) v = AUTO_SAVE_IDLE_MAX;
		if (v === this.autoSaveIdleMs) return;
		this.autoSaveIdleMs = v;
		await this.persist();
	}

	async setWarnLargeFileOpen(on: boolean): Promise<void> {
		if (this.warnLargeFileOpen === on) return;
		this.warnLargeFileOpen = on;
		await this.persist();
	}

	async setRestoreTabsOnLaunch(on: boolean): Promise<void> {
		if (this.restoreTabsOnLaunch === on) return;
		this.restoreTabsOnLaunch = on;
		await this.persist();
	}
}

export const behaviorPrefs = new BehaviorPrefs();
