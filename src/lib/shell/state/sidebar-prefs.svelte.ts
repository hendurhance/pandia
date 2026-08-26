import { SETTINGS_FILE } from '$lib/util/persist';
import { isObject } from '$lib/util/guards';
import { boolField, definePrefs, enumField, field, intField } from '$lib/util/prefs.svelte';

export const SIDEBAR_TABS = ['outline', 'schema', 'types', 'history'] as const;
export type SidebarTabId = (typeof SIDEBAR_TABS)[number];
export type SidebarSide = 'left' | 'right';

export const DEFAULT_VIEWS = ['tree', 'code', 'grid', 'graph'] as const;
export type DefaultView = (typeof DEFAULT_VIEWS)[number];

export const MIN_WIDTH = 180;
export const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

type PanelFlags = Record<SidebarTabId, boolean>;
const ALL_ENABLED: PanelFlags = { outline: true, schema: true, types: true, history: true };

const store = definePrefs({
	file: SETTINGS_FILE,
	key: 'sidebar',
	schema: {
		collapsed: boolField(false),
		width: intField(DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
		activeTab: enumField<SidebarTabId>('outline', SIDEBAR_TABS),
		side: enumField<SidebarSide>('left', ['left', 'right']),
		panels: field<PanelFlags>({ ...ALL_ENABLED }, (raw) => {
			if (!isObject(raw)) return undefined;
			return {
				outline: raw.outline !== false,
				schema: raw.schema !== false,
				types: raw.types !== false,
				history: raw.history !== false,
			};
		}),
		defaultView: enumField<DefaultView>('tree', DEFAULT_VIEWS),
	},

	normalize: (v) => {
		const panels = SIDEBAR_TABS.some((t) => v.panels[t]) ? v.panels : { ...ALL_ENABLED };
		const activeTab = panels[v.activeTab]
			? v.activeTab
			: (SIDEBAR_TABS.find((t) => panels[t]) ?? 'outline');
		return { ...v, panels, activeTab };
	},
});

const methods = {
	toggleCollapsed: () => void store.set('collapsed', !store.collapsed),
	setCollapsed: (v: boolean) => void store.set('collapsed', v),
	setWidth: (w: number) => void store.set('width', w),
	setWidthLive: (w: number): boolean => store.stage({ width: w }),
	commitWidth: () => void store.persistNow(),
	setActiveTab: (t: SidebarTabId) =>
		void store.update({
			activeTab: t,
			panels: { ...store.panels, [t]: true },
			collapsed: false,
		}),
	setSide: (s: SidebarSide) => void store.set('side', s),
	setDefaultView: (v: DefaultView) => void store.set('defaultView', v),
	setPanelEnabled: (t: SidebarTabId, on: boolean) => {
		if (store.panels[t] === on) return;
		if (!on && SIDEBAR_TABS.filter((x) => store.panels[x]).length <= 1) return;
		void store.update({ panels: { ...store.panels, [t]: on } });
	},
};

export const sidebarPrefs: typeof store & typeof methods & { enabledTabs: SidebarTabId[] } =
	Object.defineProperty(Object.assign(store, methods), 'enabledTabs', {
		get: () => SIDEBAR_TABS.filter((t) => store.panels[t]),
		enumerable: true,
	}) as typeof store & typeof methods & { enabledTabs: SidebarTabId[] };
