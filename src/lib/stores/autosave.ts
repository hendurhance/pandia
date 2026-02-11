import { writable } from 'svelte/store';
import { preferencesService } from './preferences';
import { AUTOSAVE } from '$lib/constants';

export interface AutoSaveSettings {
    enabled: boolean;
    interval: number; // in seconds
    saveOnIdle: boolean;
    idleTimeout: number; // in seconds
}

export interface AutoSaveStatus {
    lastSaved: Date | null;
    isDirty: boolean;
    isSaving: boolean;
    nextSaveIn: number; // seconds until next auto-save
}

class AutoSaveManager {
    private settings: AutoSaveSettings = {
        enabled: AUTOSAVE.ENABLED,
        interval: AUTOSAVE.INTERVAL_SECONDS,
        saveOnIdle: AUTOSAVE.SAVE_ON_IDLE,
        idleTimeout: AUTOSAVE.IDLE_TIMEOUT_SECONDS
    };

    private saveCallback: ((tabId: string, content: string) => Promise<void>) | null = null;
    private contentProvider: ((tabId: string) => string) | null = null;
    private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
    private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private lastActivity: Map<string, Date> = new Map();
    private isDirty: Map<string, boolean> = new Map();
    private isSaving: Map<string, boolean> = new Map();
    private lastSaved: Map<string, Date> = new Map();
    private lastSavedContent: Map<string, string> = new Map();
    private isInitialized = false;

    constructor() {
        this.init();
    }

    private async init() {
        if (this.isInitialized) return;
        await preferencesService.init();
        this.loadSettings();
        this.isInitialized = true;
    }

    private async ensureInit() {
        if (!this.isInitialized) {
            await this.init();
        }
    }

    private loadSettings() {
        const autoSaveSettings = preferencesService.getAutoSave();
        this.settings = { ...this.settings, ...autoSaveSettings };
    }

    private async saveSettings() {
        await this.ensureInit();
        await preferencesService.updateAutoSave(this.settings);
    }

    setSaveCallback(callback: (tabId: string, content: string) => Promise<void>) {
        this.saveCallback = callback;
    }

    setContentProvider(provider: (tabId: string) => string) {
        this.contentProvider = provider;
    }

    async updateSettings(newSettings: Partial<AutoSaveSettings>) {
        this.settings = { ...this.settings, ...newSettings };
        await this.saveSettings();

        this.intervals.forEach((_, tabId) => {
            this.stopAutoSave(tabId);
            if (this.settings.enabled) {
                this.startAutoSave(tabId);
            }
        });
    }

    getSettings(): AutoSaveSettings {
        return { ...this.settings };
    }

    startAutoSave(tabId: string) {
        if (!this.settings.enabled) return;

        this.stopAutoSave(tabId);
        this.lastActivity.set(tabId, new Date());
        this.isDirty.set(tabId, false);

        const interval = setInterval(() => {
            this.performAutoSave(tabId);
        }, this.settings.interval * 1000);

        this.intervals.set(tabId, interval);
    }

    stopAutoSave(tabId: string) {
        const interval = this.intervals.get(tabId);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(tabId);
        }

        const idleTimer = this.idleTimers.get(tabId);
        if (idleTimer) {
            clearTimeout(idleTimer);
            this.idleTimers.delete(tabId);
        }
    }

    markActivity(tabId: string, content: string) {
        this.lastActivity.set(tabId, new Date());

        const currentContent = this.getLastSavedContent(tabId);
        if (content !== currentContent) {
            this.isDirty.set(tabId, true);
        }

        const existingTimer = this.idleTimers.get(tabId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        if (this.settings.enabled && this.settings.saveOnIdle && this.isDirty.get(tabId)) {
            const idleTimer = setTimeout(() => {
                this.performAutoSave(tabId);
            }, this.settings.idleTimeout * 1000);

            this.idleTimers.set(tabId, idleTimer);
        }
    }
    
    private getLastSavedContent(tabId: string): string {
        return this.lastSavedContent.get(tabId) || '';
    }

    private async performAutoSave(tabId: string) {
        if (!this.saveCallback || !this.isDirty.get(tabId) || this.isSaving.get(tabId)) {
            return;
        }

        this.isSaving.set(tabId, true);
        autoSaveStatus.update(status => ({ ...status, isSaving: true }));

        try {
            const content = this.contentProvider ? this.contentProvider(tabId) : '';
            await this.saveCallback(tabId, content);
            this.isDirty.set(tabId, false);
            this.lastSaved.set(tabId, new Date());
            this.lastSavedContent.set(tabId, content);
            console.log(`Auto-saved tab ${tabId} at ${new Date().toLocaleTimeString()}`);
        } catch (error) {
            console.error('Auto-save failed:', error);
        } finally {
            this.isSaving.set(tabId, false);
            this.updateStatus(tabId);
        }
    }

    private updateStatus(tabId: string) {
        const status: AutoSaveStatus = {
            lastSaved: this.lastSaved.get(tabId) || null,
            isDirty: this.isDirty.get(tabId) || false,
            isSaving: this.isSaving.get(tabId) || false,
            nextSaveIn: this.settings.interval
        };

        autoSaveStatus.set(status);
    }

    getStatus(tabId: string): AutoSaveStatus {
        return {
            lastSaved: this.lastSaved.get(tabId) || null,
            isDirty: this.isDirty.get(tabId) || false,
            isSaving: this.isSaving.get(tabId) || false,
            nextSaveIn: this.settings.interval
        };
    }

    async forceSave(tabId: string): Promise<void> {
        if (this.saveCallback && this.isDirty.get(tabId)) {
            await this.performAutoSave(tabId);
        }
    }

    cleanup(tabId: string) {
        this.stopAutoSave(tabId);
        this.lastActivity.delete(tabId);
        this.isDirty.delete(tabId);
        this.isSaving.delete(tabId);
        this.lastSaved.delete(tabId);
        this.lastSavedContent.delete(tabId);
    }
}

export const autoSaveManager = new AutoSaveManager();
export const autoSaveStatus = writable<AutoSaveStatus>({
    lastSaved: null,
    isDirty: false,
    isSaving: false,
    nextSaveIn: 30
});
export const showAutoSaveSettings = writable(false);