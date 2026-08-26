import { SETTINGS_FILE } from '$lib/util/persist';
import { boolField, definePrefs, intField } from '$lib/util/prefs.svelte';

export const SCHEMA_DEBOUNCE_DEFAULT = 500;

export const SCHEMA_DEBOUNCE_IMMEDIATE = 0;
export const SCHEMA_DEBOUNCE_MANUAL = -1;
export const SCHEMA_DEBOUNCE_MAX = 5000;

export const AUTO_SAVE_IDLE_DEFAULT = 1500;
export const AUTO_SAVE_IDLE_MIN = 250;
export const AUTO_SAVE_IDLE_MAX = 10_000;

const store = definePrefs({
	file: SETTINGS_FILE,
	key: 'behavior',
	schema: {
		schemaDebounceMs: intField(
			SCHEMA_DEBOUNCE_DEFAULT,
			SCHEMA_DEBOUNCE_MANUAL,
			SCHEMA_DEBOUNCE_MAX,
		),
		autoRepairOnOpen: boolField(true),
		autoSaveOnIdle: boolField(false),
		autoSaveIdleMs: intField(AUTO_SAVE_IDLE_DEFAULT, AUTO_SAVE_IDLE_MIN, AUTO_SAVE_IDLE_MAX),
		warnLargeFileOpen: boolField(true),
		restoreTabsOnLaunch: boolField(true),
	},
});

export const behaviorPrefs = Object.assign(store, {
	setSchemaDebounce: (ms: number) => store.set('schemaDebounceMs', ms),
	setAutoRepairOnOpen: (on: boolean) => store.set('autoRepairOnOpen', on),
	setAutoSaveOnIdle: (on: boolean) => store.set('autoSaveOnIdle', on),
	setAutoSaveIdleMs: (ms: number) => store.set('autoSaveIdleMs', ms),
	setWarnLargeFileOpen: (on: boolean) => store.set('warnLargeFileOpen', on),
	setRestoreTabsOnLaunch: (on: boolean) => store.set('restoreTabsOnLaunch', on),
});
