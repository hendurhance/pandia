import Dexie, { type EntityTable } from 'dexie';
import { browser } from '$app/environment';
import { DATABASE } from '$lib/constants';
import type { Tab, CompareData } from './tabs';

export interface TabState {
  id: string;
  title: string;
  content: string;
  filePath?: string;
  isDirty: boolean;
  isNew: boolean;
  type?: 'editor' | 'compare';
  compareData?: CompareData;
  viewMode?: 'tree' | 'code' | 'text';
  scrollPosition?: { top: number; left: number };
  cursorPosition?: { line: number; column: number };
  createdAt: number;
  updatedAt: number;
}

export interface ActiveSession {
  id: string;
  activeTabId: string | null;
  tabOrder: string[];
  lastAccessed: number;
}

export interface Draft {
  id: string;
  tabId: string;
  content: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ViewState {
  tabId: string;
  viewMode: 'tree' | 'code' | 'text';
  scrollPosition: { top: number; left: number };
  cursorPosition?: { line: number; column: number };
  updatedAt: number;
}

export interface JSONBuffer {
  id: string;
  tabId: string;
  content: string;
  compressed?: boolean;
  size: number;
  createdAt: number;
  lastAccessed: number;
}

export interface StorageStats {
  tabsCount: number;
  draftsCount: number;
  buffersCount: number;
  totalSize: number;
}

class PandiaDatabase extends Dexie {
  tabs!: EntityTable<TabState, 'id'>;
  sessions!: EntityTable<ActiveSession, 'id'>;
  drafts!: EntityTable<Draft, 'id'>;
  viewStates!: EntityTable<ViewState, 'tabId'>;
  buffers!: EntityTable<JSONBuffer, 'id'>;

  constructor() {
    super(DATABASE.NAME);
    this.version(DATABASE.VERSION).stores({
      tabs: '&id, updatedAt, filePath',
      sessions: '&id',
      drafts: '&id, tabId, createdAt',
      viewStates: '&tabId, updatedAt',
      buffers: '&id, tabId, lastAccessed, size'
    });
  }
}

class DatabaseService {
  private db: PandiaDatabase | null = null;
  private available = false;

  get isAvailable(): boolean {
    return this.available;
  }

  constructor() {
    if (browser && typeof indexedDB !== 'undefined') {
      try {
        this.db = new PandiaDatabase();
        this.available = true;
      } catch {
        this.available = false;
      }
    }
  }

  async init(): Promise<void> {
    if (!this.available || !this.db) return;
    try {
      await this.db.open();
    } catch {
      this.available = false;
    }
  }

  async saveTabs(tabs: Tab[]): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    await this.db.tabs.bulkPut(
      tabs.map(tab => ({ ...tab, createdAt: now, updatedAt: now }))
    );
  }

  async loadTabs(): Promise<TabState[]> {
    if (!this.db) return [];
    return this.db.tabs.orderBy('updatedAt').reverse().toArray();
  }

  async saveTab(tab: Tab): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    await this.db.tabs.put({ ...tab, createdAt: now, updatedAt: now });
  }

  async deleteTab(tabId: string): Promise<void> {
    if (!this.db) return;
    await this.db.transaction('rw', [this.db.tabs, this.db.viewStates, this.db.buffers], async () => {
      await Promise.all([
        this.db!.tabs.delete(tabId),
        this.db!.viewStates.delete(tabId),
        this.db!.buffers.where('tabId').equals(tabId).delete()
      ]);
    });
  }

  async saveSession(session: Omit<ActiveSession, 'id'>): Promise<void> {
    if (!this.db) return;
    await this.db.sessions.put({ id: DATABASE.SESSION_ID, ...session });
  }

  async loadSession(): Promise<ActiveSession | null> {
    if (!this.db) return null;
    return (await this.db.sessions.get(DATABASE.SESSION_ID)) ?? null;
  }

  async saveDraft(draft: Omit<Draft, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!this.db) return '';
    const now = Date.now();
    const id = `draft_${draft.tabId}_${now}`;
    await this.db.drafts.put({ id, ...draft, createdAt: now, updatedAt: now });
    return id;
  }

  async loadDrafts(tabId?: string): Promise<Draft[]> {
    if (!this.db) return [];
    if (tabId) {
      return this.db.drafts.where('tabId').equals(tabId).toArray();
    }
    return this.db.drafts.orderBy('createdAt').reverse().toArray();
  }

  async deleteDraft(draftId: string): Promise<void> {
    if (!this.db) return;
    await this.db.drafts.delete(draftId);
  }

  async saveViewState(viewState: Omit<ViewState, 'updatedAt'>): Promise<void> {
    if (!this.db) return;
    await this.db.viewStates.put({ ...viewState, updatedAt: Date.now() });
  }

  async loadViewState(tabId: string): Promise<ViewState | null> {
    if (!this.db) return null;
    return (await this.db.viewStates.get(tabId)) ?? null;
  }

  async saveBuffer(buffer: Omit<JSONBuffer, 'id' | 'createdAt' | 'lastAccessed'>): Promise<string> {
    if (!this.db) return '';
    const now = Date.now();
    const id = `buffer_${buffer.tabId}_${now}`;
    await this.db.buffers.put({ id, ...buffer, createdAt: now, lastAccessed: now });
    return id;
  }

  async loadBuffer(bufferId: string): Promise<JSONBuffer | null> {
    if (!this.db) return null;
    const buffer = await this.db.buffers.get(bufferId);
    if (buffer) {
      await this.db.buffers.update(bufferId, { lastAccessed: Date.now() });
    }
    return buffer ?? null;
  }

  async deleteBuffer(bufferId: string): Promise<void> {
    if (!this.db) return;
    await this.db.buffers.delete(bufferId);
  }

  async cleanupOldBuffers(maxAge = DATABASE.MAX_BUFFER_AGE): Promise<number> {
    if (!this.db) return 0;
    const cutoff = Date.now() - maxAge;
    return this.db.buffers.where('lastAccessed').below(cutoff).delete();
  }

  /**
   * Remove viewStates that have no matching tab (orphaned)
   */
  async cleanupOrphanedViewStates(): Promise<number> {
    if (!this.db) return 0;
    const [viewStates, tabs] = await Promise.all([
      this.db.viewStates.toArray(),
      this.db.tabs.toArray()
    ]);
    const tabIds = new Set(tabs.map(t => t.id));
    const orphanedIds = viewStates
      .filter(vs => !tabIds.has(vs.tabId))
      .map(vs => vs.tabId);

    if (orphanedIds.length > 0) {
      await this.db.viewStates.bulkDelete(orphanedIds);
    }
    return orphanedIds.length;
  }

  /**
   * Remove drafts that have no matching tab OR are older than maxAge
   */
  async cleanupOrphanedDrafts(maxAge = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    if (!this.db) return 0;
    const [drafts, tabs] = await Promise.all([
      this.db.drafts.toArray(),
      this.db.tabs.toArray()
    ]);
    const tabIds = new Set(tabs.map(t => t.id));
    const cutoff = Date.now() - maxAge;

    const orphanedIds = drafts
      .filter(d => !tabIds.has(d.tabId) || d.updatedAt < cutoff)
      .map(d => d.id);

    if (orphanedIds.length > 0) {
      await this.db.drafts.bulkDelete(orphanedIds);
    }
    return orphanedIds.length;
  }

  /**
   * Run all cleanup tasks - call this on app startup
   */
  async runStartupCleanup(): Promise<{
    buffers: number;
    viewStates: number;
    drafts: number;
  }> {
    if (!this.db) return { buffers: 0, viewStates: 0, drafts: 0 };

    const [buffers, viewStates, drafts] = await Promise.all([
      this.cleanupOldBuffers(),
      this.cleanupOrphanedViewStates(),
      this.cleanupOrphanedDrafts()
    ]);

    const total = buffers + viewStates + drafts;
    if (total > 0) {
      console.log(`[Database] Startup cleanup: removed ${buffers} old buffers, ${viewStates} orphaned viewStates, ${drafts} orphaned drafts`);
    }

    return { buffers, viewStates, drafts };
  }

  async clearAll(): Promise<void> {
    if (!this.db) return;
    await this.db.transaction('rw', [this.db.tabs, this.db.sessions, this.db.drafts, this.db.viewStates, this.db.buffers], async () => {
      await Promise.all([
        this.db!.tabs.clear(),
        this.db!.sessions.clear(),
        this.db!.drafts.clear(),
        this.db!.viewStates.clear(),
        this.db!.buffers.clear()
      ]);
    });
  }

  async getStats(): Promise<StorageStats> {
    if (!this.db) {
      return { tabsCount: 0, draftsCount: 0, buffersCount: 0, totalSize: 0 };
    }
    const [tabsCount, draftsCount, buffersCount] = await Promise.all([
      this.db.tabs.count(),
      this.db.drafts.count(),
      this.db.buffers.count()
    ]);
    const totalSize = await this.estimateSize();
    return { tabsCount, draftsCount, buffersCount, totalSize };
  }

  private async estimateSize(): Promise<number> {
    if (!this.db) return 0;
    const [tabs, drafts, buffers] = await Promise.all([
      this.db.tabs.toArray(),
      this.db.drafts.toArray(),
      this.db.buffers.toArray()
    ]);
    return (
      new Blob([JSON.stringify(tabs)]).size +
      new Blob([JSON.stringify(drafts)]).size +
      new Blob([JSON.stringify(buffers)]).size
    );
  }

  async exportAll(): Promise<{
    tabs: TabState[];
    session: ActiveSession | null;
    drafts: Draft[];
    viewStates: ViewState[];
    buffers: JSONBuffer[];
  }> {
    if (!this.db) {
      return { tabs: [], session: null, drafts: [], viewStates: [], buffers: [] };
    }
    const [tabs, session, drafts, viewStates, buffers] = await Promise.all([
      this.db.tabs.toArray(),
      this.db.sessions.get(DATABASE.SESSION_ID),
      this.db.drafts.toArray(),
      this.db.viewStates.toArray(),
      this.db.buffers.toArray()
    ]);
    return { tabs, session: session ?? null, drafts, viewStates, buffers };
  }

  async importAll(data: {
    tabs?: TabState[];
    session?: ActiveSession;
    drafts?: Draft[];
    viewStates?: ViewState[];
    buffers?: JSONBuffer[];
  }): Promise<void> {
    if (!this.db) return;
    await this.db.transaction('rw', [this.db.tabs, this.db.sessions, this.db.drafts, this.db.viewStates, this.db.buffers], async () => {
      if (data.tabs) await this.db!.tabs.bulkPut(data.tabs);
      if (data.session) await this.db!.sessions.put(data.session);
      if (data.drafts) await this.db!.drafts.bulkPut(data.drafts);
      if (data.viewStates) await this.db!.viewStates.bulkPut(data.viewStates);
      if (data.buffers) await this.db!.buffers.bulkPut(data.buffers);
    });
  }
}

export const databaseService = new DatabaseService();
