import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { PersistedStore } from '$lib/util/persisted-store.svelte';
import { isObject, oneOf } from '$lib/util/guards';

const STORE_KEY = 'sidebar';

export const SIDEBAR_TABS = ['outline', 'schema', 'types', 'history'] as const;
export type SidebarTabId = (typeof SIDEBAR_TABS)[number];
export type SidebarSide = 'left' | 'right';

export const MIN_WIDTH = 180;
export const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

type PanelFlags = Record<SidebarTabId, boolean>;
const ALL_ENABLED: PanelFlags = { outline: true, schema: true, types: true, history: true };

interface Persisted {
	collapsed: boolean;
	width: number;
	activeTab: SidebarTabId;
	side: SidebarSide;
	panels: PanelFlags;
}

function sanitize(raw: unknown): Persisted {
	const defaults: Persisted = {
		collapsed: false,
		width: DEFAULT_WIDTH,
		activeTab: 'outline',
		side: 'left',
		panels: { ...ALL_ENABLED },
	};
	if (!isObject(raw)) return defaults;
	const p = raw;
	const rawPanels = isObject(p.panels) ? p.panels : {};
	const panels: PanelFlags = {
		outline: rawPanels.outline !== false,
		schema: rawPanels.schema !== false,
		types: rawPanels.types !== false,
		history: rawPanels.history !== false,
	};
	if (!SIDEBAR_TABS.some((t) => panels[t])) Object.assign(panels, ALL_ENABLED);

	let activeTab: SidebarTabId = oneOf(p.activeTab, SIDEBAR_TABS) ? p.activeTab : 'outline';
	if (!panels[activeTab]) activeTab = SIDEBAR_TABS.find((t) => panels[t]) ?? 'outline';

	return {
		collapsed: typeof p.collapsed === 'boolean' ? p.collapsed : false,
		width:
			typeof p.width === 'number'
				? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, p.width))
				: DEFAULT_WIDTH,
		activeTab,
		side: p.side === 'right' ? 'right' : 'left',
		panels,
	};
}

class SidebarPrefs extends PersistedStore {
	collapsed: boolean = $state(false);
	width: number = $state(DEFAULT_WIDTH);
	activeTab: SidebarTabId = $state('outline');
	side: SidebarSide = $state('left');
	panels: PanelFlags = $state({ ...ALL_ENABLED });

	
	enabledTabs: SidebarTabId[] = $derived(SIDEBAR_TABS.filter((t) => this.panels[t]));

	protected async load(): Promise<void> {
		const p = sanitize(await loadPersisted<Persisted>(SETTINGS_FILE, STORE_KEY));
		this.collapsed = p.collapsed;
		this.width = p.width;
		this.activeTab = p.activeTab;
		this.side = p.side;
		this.panels = p.panels;
	}

	private persist(): void {
		void savePersisted(SETTINGS_FILE, STORE_KEY, {
			collapsed: this.collapsed,
			width: this.width,
			activeTab: this.activeTab,
			side: this.side,
			panels: this.panels,
		} satisfies Persisted);
	}

	toggleCollapsed(): void {
		this.collapsed = !this.collapsed;
		this.persist();
	}

	setCollapsed(v: boolean): void {
		if (this.collapsed === v) return;
		this.collapsed = v;
		this.persist();
	}

	setWidth(w: number): void {
		const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
		if (this.width === clamped) return;
		this.width = clamped;
		this.persist();
	}

	setActiveTab(t: SidebarTabId): void {
		if (!this.panels[t]) this.panels = { ...this.panels, [t]: true };
		this.activeTab = t;
		if (this.collapsed) this.collapsed = false;
		this.persist();
	}

	setSide(s: SidebarSide): void {
		if (this.side === s) return;
		this.side = s;
		this.persist();
	}

	setPanelEnabled(t: SidebarTabId, on: boolean): void {
		if (this.panels[t] === on) return;
		if (!on && SIDEBAR_TABS.filter((x) => this.panels[x]).length <= 1) return;
		this.panels = { ...this.panels, [t]: on };
		if (!on && this.activeTab === t) {
			const next = SIDEBAR_TABS.find((x) => this.panels[x]);
			if (next) this.activeTab = next;
		}
		this.persist();
	}
}

export const sidebarPrefs = new SidebarPrefs();
