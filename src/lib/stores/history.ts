import { writable } from 'svelte/store';
import { AUTOSAVE } from '$lib/constants';

export interface HistoryState {
    content: string;
    timestamp: number;
    cursor?: { line: number; column: number };
}

class HistoryManager {
    private history: Map<string, HistoryState[]> = new Map();
    private currentIndex: Map<string, number> = new Map();
    private maxHistorySize = AUTOSAVE.MAX_HISTORY_SIZE;

    saveState(tabId: string, content: string, cursor?: { line: number; column: number }) {
        if (!this.history.has(tabId)) {
            this.history.set(tabId, []);
            this.currentIndex.set(tabId, -1);
        }

        const tabHistory = this.history.get(tabId)!;
        const currentIdx = this.currentIndex.get(tabId)!;

        if (tabHistory.length > 0 && tabHistory[currentIdx]?.content === content) {
            return;
        }

        // Remove any history after current index (when we're not at the end)
        if (currentIdx < tabHistory.length - 1) {
            tabHistory.splice(currentIdx + 1);
        }

        // Add new state
        const newState: HistoryState = {
            content,
            timestamp: Date.now(),
            cursor
        };

        tabHistory.push(newState);
        
        // Keep history size manageable
        if (tabHistory.length > this.maxHistorySize) {
            tabHistory.shift();
        } else {
            this.currentIndex.set(tabId, this.currentIndex.get(tabId)! + 1);
        }

        // Update the current index to point to the new state
        this.currentIndex.set(tabId, tabHistory.length - 1);
    }

    undo(tabId: string): HistoryState | null {
        const tabHistory = this.history.get(tabId);
        const currentIdx = this.currentIndex.get(tabId);

        if (!tabHistory || currentIdx === undefined || currentIdx <= 0) {
            return null;
        }

        this.currentIndex.set(tabId, currentIdx - 1);
        return tabHistory[currentIdx - 1];
    }

    redo(tabId: string): HistoryState | null {
        const tabHistory = this.history.get(tabId);
        const currentIdx = this.currentIndex.get(tabId);

        if (!tabHistory || currentIdx === undefined || currentIdx >= tabHistory.length - 1) {
            return null;
        }

        this.currentIndex.set(tabId, currentIdx + 1);
        return tabHistory[currentIdx + 1];
    }

    canUndo(tabId: string): boolean {
        const currentIdx = this.currentIndex.get(tabId);
        return currentIdx !== undefined && currentIdx > 0;
    }

    canRedo(tabId: string): boolean {
        const tabHistory = this.history.get(tabId);
        const currentIdx = this.currentIndex.get(tabId);
        return tabHistory !== undefined && currentIdx !== undefined && currentIdx < tabHistory.length - 1;
    }

    clearHistory(tabId: string) {
        this.history.delete(tabId);
        this.currentIndex.delete(tabId);
    }

    getHistoryInfo(tabId: string): { current: number; total: number } {
        const tabHistory = this.history.get(tabId);
        const currentIdx = this.currentIndex.get(tabId);
        
        return {
            current: currentIdx !== undefined ? currentIdx + 1 : 0,
            total: tabHistory ? tabHistory.length : 0
        };
    }
}

export const historyManager = new HistoryManager();
export const historyInfo = writable<{ tabId: string; current: number; total: number } | null>(null);