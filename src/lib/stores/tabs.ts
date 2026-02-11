import { writable, derived, get } from 'svelte/store';
import { databaseService, type TabState } from './database';
import { autoSaveManager } from './autosave';

export interface CompareData {
	leftContent: string;
	leftTitle: string;
	leftFilePath?: string;
	rightContent: string;
	rightTitle: string;
	rightFilePath?: string;
}

export interface Tab {
	id: string;
	title: string;
	content: string;
	filePath?: string;
	isDirty: boolean;
	isNew: boolean;
	type?: 'editor' | 'compare';
	compareData?: CompareData;
	viewMode?: 'tree' | 'code' | 'text';
	scrollPosition?: {
		top: number;
		left: number;
	};
	cursorPosition?: {
		line: number;
		column: number;
	};
}

class TabManager {
	tabsStore = writable<Tab[]>([]);
	private currentTabIdStore = writable<string | null>(null);
	private isInitialized = true; // Start initialized for instant loading
	private contentSaveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private readonly CONTENT_SAVE_DEBOUNCE = 300; // ms

	constructor() {
		// Initialize in background without blocking
		this.initBackground();
	}

	private initBackground() {
		// Load from IndexedDB in background - don't block UI
		setTimeout(async () => {
			try {
				await databaseService.init();
				await this.loadFromIndexedDB();
				console.log('Tabs loaded from IndexedDB in background');
			} catch (error) {
				console.warn('Background tab loading failed, using in-memory:', error);
			}
		}, 100); // Small delay to let UI render first
	}

	// All initialization is now non-blocking - IndexedDB loads in background

	private async loadFromIndexedDB() {
		try {
			const [tabStates, session] = await Promise.all([
				databaseService.loadTabs(),
				databaseService.loadSession()
			]);

			const tabs: Tab[] = tabStates.map(state => ({
				id: state.id,
				title: state.title,
				content: state.content,
				filePath: state.filePath,
				isDirty: state.isDirty,
				isNew: state.isNew,
				type: state.type,
				compareData: state.compareData,
				viewMode: state.viewMode,
				scrollPosition: state.scrollPosition,
				cursorPosition: state.cursorPosition,
			}));

			this.tabsStore.set(tabs);

			if (session?.activeTabId && tabs.find(t => t.id === session.activeTabId)) {
				this.currentTabIdStore.set(session.activeTabId);
			} else if (tabs.length > 0) {
				this.currentTabIdStore.set(tabs[0].id);
			}
		} catch (error) {
			console.error('Failed to load tabs from IndexedDB:', error);
		}
	}

	private async saveToIndexedDB() {
		try {
			if (databaseService.isAvailable) {
				const tabs = get(this.tabsStore);
				const currentTabId = get(this.currentTabIdStore);

				await Promise.all([
					databaseService.saveTabs(tabs),
					databaseService.saveSession({
						activeTabId: currentTabId,
						tabOrder: tabs.map(t => t.id),
						lastAccessed: Date.now(),
					})
				]);
			}
		} catch (error) {
			console.error('Failed to save tabs to IndexedDB:', error);
		}
	}

	subscribe = this.tabsStore.subscribe;

	async add(tab: Omit<Tab, 'id'>): Promise<string> {
		const id = Math.random().toString(36).substr(2, 9);
		const newTab: Tab = { ...tab, id };
		
		// Always update in-memory store immediately for UI responsiveness
		this.tabsStore.update(tabs => [...tabs, newTab]);
		this.currentTabIdStore.set(id);
		
		// Persist asynchronously without blocking
		setTimeout(() => {
			try {
				databaseService.saveTab(newTab);
				this.saveToIndexedDB();
			} catch (error) {
				console.error('Failed to save new tab:', error);
			}
		}, 0);
		
		return id;
	}

	async remove(id: string): Promise<void> {
		const pendingTimer = this.contentSaveTimers.get(id);
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			this.contentSaveTimers.delete(id);
		}

		autoSaveManager.cleanup(id);

		// Update UI immediately
		this.tabsStore.update(tabs => {
			const filtered = tabs.filter(tab => tab.id !== id);
			const currentId = get(this.currentTabIdStore);

			if (currentId === id && filtered.length > 0) {
				this.currentTabIdStore.set(filtered[filtered.length - 1].id);
			} else if (filtered.length === 0) {
				this.currentTabIdStore.set(null);
			}

			return filtered;
		});

		// Persist asynchronously
		setTimeout(async () => {
			try {
				await databaseService.deleteTab(id);
				await this.saveToIndexedDB();
			} catch (error) {
				console.error('Failed to delete tab:', error);
			}
		}, 0);
	}

	async updateContent(id: string, content: string): Promise<void> {
		this.tabsStore.update(tabs => tabs.map(tab =>
			tab.id === id
				? { ...tab, content, isDirty: true }
				: tab
		));

		const existingTimer = this.contentSaveTimers.get(id);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(async () => {
			this.contentSaveTimers.delete(id);
			try {
				const tab = get(this.tabsStore).find(t => t.id === id);
				if (tab) {
					await databaseService.saveTab(tab);
				}
			} catch (error) {
				console.error('Failed to save tab content:', error);
			}
		}, this.CONTENT_SAVE_DEBOUNCE);

		this.contentSaveTimers.set(id, timer);
	}

	async updateTitle(id: string, title: string): Promise<void> {
		this.tabsStore.update(tabs => tabs.map(tab =>
			tab.id === id
				? { ...tab, title }
				: tab
		));

		setTimeout(async () => {
			try {
				const tab = get(this.tabsStore).find(t => t.id === id);
				if (tab) {
					await databaseService.saveTab(tab);
				}
			} catch (error) {
				console.error('Failed to save tab title:', error);
			}
		}, 0);
	}

	async markSaved(id: string, filePath?: string): Promise<void> {
		this.tabsStore.update(tabs => tabs.map(tab =>
			tab.id === id
				? { ...tab, isDirty: false, isNew: false, filePath: filePath || tab.filePath }
				: tab
		));

		setTimeout(async () => {
			try {
				const tab = get(this.tabsStore).find(t => t.id === id);
				if (tab) {
					await databaseService.saveTab(tab);
				}
			} catch (error) {
				console.error('Failed to mark tab as saved:', error);
			}
		}, 0);
	}

	async updateCompareData(id: string, compareData: Partial<CompareData>): Promise<void> {
		this.tabsStore.update(tabs => tabs.map(tab =>
			tab.id === id && tab.type === 'compare'
				? { ...tab, compareData: { ...tab.compareData, ...compareData } as CompareData }
				: tab
		));

		setTimeout(async () => {
			try {
				const tab = get(this.tabsStore).find(t => t.id === id);
				if (tab) {
					await databaseService.saveTab(tab);
				}
			} catch (error) {
				console.error('Failed to save compare data:', error);
			}
		}, 0);
	}

	async updateViewState(id: string, viewState: Partial<Pick<Tab, 'viewMode' | 'scrollPosition' | 'cursorPosition'>>): Promise<void> {
		this.tabsStore.update(tabs => tabs.map(tab =>
			tab.id === id
				? { ...tab, ...viewState }
				: tab
		));

		setTimeout(async () => {
			try {
				const tab = get(this.tabsStore).find(t => t.id === id);
				if (tab) {
					await databaseService.saveTab(tab);

					if (tab.viewMode) {
						await databaseService.saveViewState({
							tabId: id,
							viewMode: tab.viewMode,
							scrollPosition: tab.scrollPosition || { top: 0, left: 0 },
							cursorPosition: tab.cursorPosition,
						});
					}
				}
			} catch (error) {
				console.error('Failed to save tab view state:', error);
			}
		}, 0);
	}

	async clear(): Promise<void> {
		this.contentSaveTimers.forEach(timer => clearTimeout(timer));
		this.contentSaveTimers.clear();

		const currentTabs = get(this.tabsStore);
		currentTabs.forEach(tab => autoSaveManager.cleanup(tab.id));

		this.tabsStore.set([]);
		this.currentTabIdStore.set(null);

		setTimeout(async () => {
			try {
				await databaseService.clearAll();
			} catch (error) {
				console.error('Failed to clear tabs:', error);
			}
		}, 0);
	}

	getCurrentTabId = () => this.currentTabIdStore;
	
	setCurrentTab(id: string | null) {
		this.currentTabIdStore.set(id);
		setTimeout(() => {
			this.saveToIndexedDB();
		}, 0);
	}
}

const tabManager = new TabManager();

export const tabs = {
	subscribe: tabManager.subscribe,
	add: tabManager.add.bind(tabManager),
	remove: tabManager.remove.bind(tabManager),
	updateContent: tabManager.updateContent.bind(tabManager),
	updateTitle: tabManager.updateTitle.bind(tabManager),
	markSaved: tabManager.markSaved.bind(tabManager),
	updateCompareData: tabManager.updateCompareData.bind(tabManager),
	updateViewState: tabManager.updateViewState.bind(tabManager),
	clear: tabManager.clear.bind(tabManager),
	getTabs: () => get(tabManager.tabsStore),
	setCurrentTab: tabManager.setCurrentTab.bind(tabManager),
};

export const currentTabId = tabManager.getCurrentTabId();

export const currentTab = derived(
	[tabs, currentTabId],
	([tabList, currentId]) => tabList.find(tab => tab.id === currentId) || null
);