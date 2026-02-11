import { writable, get, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { UI, DATABASE, BYTES, AUTOSAVE, FILE_LIMITS } from '$lib/constants';

export interface AppPreferences {
  theme: {
    preference: 'system' | 'light' | 'dark' | string;
    customThemes: Record<string, unknown>;
  };
  editor: {
    fontSize: number;
    fontFamily: string;
    wordWrap: boolean;
    showLineNumbers: boolean;
    indentSize: number;
    tabSize: number;
  };
  ui: {
    sidebarWidth: number;
    showToolbar: boolean;
    compactMode: boolean;
    showStatusBar: boolean;
  };
  files: {
    recentFiles: RecentFile[];
    maxRecentFiles: number;
    autoSave: AutoSaveConfig;
  };
  performance: {
    largeFileThreshold: number;
    enableLazyLoading: boolean;
    chunkSize: number;
    maxMemoryUsage: number;
  };
  privacy: {
    enableAnalytics: boolean;
    enableCrashReports: boolean;
    enableTelemetry: boolean;
  };
  app: {
    isFirstTime: boolean;
    lastVersion: string;
    installDate: number;
  };
}

export interface RecentFile {
  path: string;
  name: string;
  lastOpened: number;
  size?: number;
  type?: 'json' | 'text' | 'other';
}

export interface AutoSaveConfig {
  enabled: boolean;
  interval: number;
  saveOnIdle: boolean;
  idleTimeout: number;
}

export const defaultPreferences: AppPreferences = {
  theme: {
    preference: 'system',
    customThemes: {},
  },
  editor: {
    fontSize: UI.FONT_SIZE,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    wordWrap: true,
    showLineNumbers: true,
    indentSize: UI.INDENT_SIZE,
    tabSize: UI.TAB_SIZE,
  },
  ui: {
    sidebarWidth: UI.SIDEBAR_WIDTH,
    showToolbar: true,
    compactMode: false,
    showStatusBar: true,
  },
  files: {
    recentFiles: [],
    maxRecentFiles: DATABASE.MAX_RECENT_FILES,
    autoSave: {
      enabled: AUTOSAVE.ENABLED,
      interval: AUTOSAVE.INTERVAL_SECONDS,
      saveOnIdle: AUTOSAVE.SAVE_ON_IDLE,
      idleTimeout: AUTOSAVE.IDLE_TIMEOUT_SECONDS,
    },
  },
  performance: {
    largeFileThreshold: FILE_LIMITS.LARGE_FILE_THRESHOLD,
    enableLazyLoading: true,
    chunkSize: BYTES.MB,
    maxMemoryUsage: FILE_LIMITS.MAX_MEMORY_USAGE,
  },
  privacy: {
    enableAnalytics: false,
    enableCrashReports: true,
    enableTelemetry: false,
  },
  app: {
    isFirstTime: true,
    lastVersion: '1.0.0',
    installDate: Date.now(),
  },
};

class PreferencesService {
  private store: unknown = null;
  private initialized = false;
  private available = false;
  private prefs = writable<AppPreferences>(defaultPreferences);

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!browser) {
      this.initialized = true;
      return;
    }

    try {
      const { load } = await import('@tauri-apps/plugin-store');
      this.store = await load('preferences.json', { 
        defaults: { prefs: defaultPreferences },
        autoSave: true 
      });
      this.available = true;
      this.initialized = true;
      await this.load();
      this.setupAutoSave();
    } catch {
      this.initialized = true;
      this.available = false;
    }
  }

  private setupAutoSave(): void {
    if (!browser) return;
    window.addEventListener('beforeunload', () => this.save());
  }

  private async load(): Promise<void> {
    if (!this.available || !this.store) return;
    try {
      const stored = await (this.store as { get: (key: string) => Promise<AppPreferences | null> }).get('prefs');
      if (stored) {
        this.prefs.set(this.merge(defaultPreferences, stored));
      } else {
        await this.save();
      }
    } catch {
      // Use defaults on error
    }
  }

  private async save(): Promise<void> {
    if (!this.available || !this.store) return;
    try {
      const current = this.get();
      await (this.store as { set: (key: string, value: unknown) => Promise<void> }).set('prefs', current);
      await (this.store as { save: () => Promise<void> }).save();
    } catch {}
  }

  private merge(defaults: AppPreferences, stored: Partial<AppPreferences>): AppPreferences {
    return {
      theme: { ...defaults.theme, ...stored.theme },
      editor: { ...defaults.editor, ...stored.editor },
      ui: { ...defaults.ui, ...stored.ui },
      files: {
        ...defaults.files,
        ...stored.files,
        autoSave: { ...defaults.files.autoSave, ...stored.files?.autoSave }
      },
      performance: { ...defaults.performance, ...stored.performance },
      privacy: { ...defaults.privacy, ...stored.privacy },
      app: { ...defaults.app, ...stored.app },
    };
  }

  get(): AppPreferences {
    return get(this.prefs);
  }

  getStore(): Writable<AppPreferences> {
    return this.prefs;
  }

  async update(updates: Partial<AppPreferences>): Promise<void> {
    const current = this.get();
    const updated = this.merge(current, updates);
    this.prefs.set(updated);
    await this.save();
  }

  async reset(): Promise<void> {
    this.prefs.set(defaultPreferences);
    await this.save();
  }

  getTheme(): string {
    return this.get().theme.preference;
  }

  async setTheme(theme: string): Promise<void> {
    const current = this.get();
    await this.update({ theme: { ...current.theme, preference: theme } });
  }

  getCustomThemes(): Record<string, unknown> {
    return this.get().theme.customThemes;
  }

  async saveCustomTheme(name: string, theme: unknown): Promise<void> {
    const current = this.get();
    await this.update({
      theme: {
        ...current.theme,
        customThemes: { ...current.theme.customThemes, [name]: theme }
      }
    });
  }

  async deleteCustomTheme(name: string): Promise<void> {
    const current = this.get();
    const { [name]: _, ...rest } = current.theme.customThemes;
    await this.update({ theme: { ...current.theme, customThemes: rest } });
  }

  getRecentFiles(): RecentFile[] {
    return this.get().files.recentFiles;
  }

  async addRecentFile(file: Omit<RecentFile, 'lastOpened'>): Promise<void> {
    const current = this.get();
    const files = current.files.recentFiles.filter(f => f.path !== file.path);
    files.unshift({ ...file, lastOpened: Date.now() });
    await this.update({
      files: {
        ...current.files,
        recentFiles: files.slice(0, current.files.maxRecentFiles)
      }
    });
  }

  async removeRecentFile(path: string): Promise<void> {
    const current = this.get();
    await this.update({
      files: {
        ...current.files,
        recentFiles: current.files.recentFiles.filter(f => f.path !== path)
      }
    });
  }

  async clearRecentFiles(): Promise<void> {
    const current = this.get();
    await this.update({ files: { ...current.files, recentFiles: [] } });
  }

  getAutoSave(): AutoSaveConfig {
    return this.get().files.autoSave;
  }

  async updateAutoSave(config: Partial<AutoSaveConfig>): Promise<void> {
    const current = this.get();
    await this.update({
      files: {
        ...current.files,
        autoSave: { ...current.files.autoSave, ...config }
      }
    });
  }

  isFirstTime(): boolean {
    return this.get().app.isFirstTime;
  }

  async markNotFirstTime(): Promise<void> {
    await this.update({ app: { isFirstTime: false, lastVersion: '1.0.0', installDate: Date.now() } });
  }

  export(): string {
    return JSON.stringify(this.get(), null, 2);
  }

  async import(json: string): Promise<void> {
    const imported = JSON.parse(json) as Partial<AppPreferences>;
    const merged = this.merge(defaultPreferences, imported);
    this.prefs.set(merged);
    await this.save();
  }

  async cleanup(): Promise<void> {
    await this.save();
  }
}

export const preferencesService = new PreferencesService();
