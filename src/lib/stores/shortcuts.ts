import { writable } from 'svelte/store';

export interface KeyboardShortcut {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
    action: string;
    description: string;
}

export interface ShortcutAction {
    action: string;
    callback: () => void;
}

class KeyboardShortcutManager {
    private shortcuts: KeyboardShortcut[] = [];
    private actions: Map<string, () => void> = new Map();
    private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
    private isBound = false;

    constructor() {
        this.setupDefaultShortcuts();
        this.bindKeyListener();
    }

    /**
     * Clean up event listeners - call this when the manager is no longer needed
     */
    destroy() {
        this.unbindKeyListener();
        this.actions.clear();
    }

    private setupDefaultShortcuts() {
        const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
        
        this.shortcuts = [
            // File operations
            { key: 's', ctrl: true, action: 'save', description: 'Save current file' },
            { key: 'o', ctrl: true, action: 'open', description: 'Open file' },
            { key: 'n', ctrl: true, action: 'new', description: 'New file' },
            { key: 'w', ctrl: true, action: 'close-tab', description: 'Close current tab' },
            { key: 't', ctrl: true, action: 'new-tab', description: 'New tab' },
            
            // Edit operations
            { key: 'z', ctrl: true, action: 'undo', description: 'Undo' },
            { key: 'y', ctrl: true, action: 'redo', description: 'Redo' },
            { key: 'z', ctrl: true, shift: true, action: 'redo', description: 'Redo (alternative)' },
            
            // Search operations
            { key: 'f', ctrl: true, action: 'find', description: 'Find' },
            { key: 'h', ctrl: true, action: 'replace', description: 'Find & Replace' },
            { key: 'g', ctrl: true, action: 'find-next', description: 'Find next' },
            { key: 'g', ctrl: true, shift: true, action: 'find-previous', description: 'Find previous' },
            
            // JSON operations
            { key: 'f', ctrl: true, shift: true, action: 'format', description: 'Format JSON' },
            { key: 'j', ctrl: true, shift: true, action: 'compress', description: 'Compress JSON' },
            { key: 'v', ctrl: true, shift: true, action: 'validate', description: 'Validate JSON' },
            
            // View operations
            { key: '1', ctrl: true, action: 'view-tree', description: 'Switch to Tree view' },
            { key: '2', ctrl: true, action: 'view-code', description: 'Switch to Code view' },
            { key: '3', ctrl: true, action: 'view-form', description: 'Switch to Form view' },
            { key: '4', ctrl: true, action: 'view-text', description: 'Switch to Text view' },
            { key: '5', ctrl: true, action: 'view-grid', description: 'Switch to Grid view' },
            
            // System shortcuts
            { key: 'k', ctrl: true, action: 'shortcuts', description: 'Show shortcuts' },
            { key: ',', ctrl: true, action: 'settings', description: 'Open settings' },
            
            // Tab navigation
            { key: 'Tab', ctrl: true, action: 'next-tab', description: 'Next tab' },
            { key: 'Tab', ctrl: true, shift: true, action: 'prev-tab', description: 'Previous tab' },
            
            // Editor clipboard (let these pass through to editor)
            { key: 'a', ctrl: true, action: 'select-all', description: 'Select all content' },
            { key: 'v', ctrl: true, action: 'paste', description: 'Paste content' },
            { key: 'c', ctrl: true, action: 'copy', description: 'Copy selected content' },
            { key: 'x', ctrl: true, action: 'cut', description: 'Cut selected content' },
        ];
    }

    private bindKeyListener() {
        if (typeof window !== 'undefined' && !this.isBound) {
            this.keydownHandler = (event: KeyboardEvent) => {
                this.handleKeyDown(event);
            };
            window.addEventListener('keydown', this.keydownHandler);
            this.isBound = true;
        }
    }

    private unbindKeyListener() {
        if (typeof window !== 'undefined' && this.isBound && this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
            this.isBound = false;
        }
    }

    private handleKeyDown(event: KeyboardEvent) {
        // Early exit for common keys that shouldn't trigger shortcuts
        if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
            return;
        }

        // Skip if user is typing in an input field
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
            // Only allow certain shortcuts in input fields
            const allowedInInputs = ['save', 'open', 'new', 'undo', 'redo', 'find', 'replace'];
            const isAllowedShortcut = this.shortcuts.some(s => 
                allowedInInputs.includes(s.action) &&
                s.key.toLowerCase() === event.key.toLowerCase() &&
                !!s.ctrl === (event.ctrlKey || event.metaKey) &&
                !!s.shift === event.shiftKey &&
                !!s.alt === event.altKey
            );
            if (!isAllowedShortcut) return;
        }

        const shortcut = this.shortcuts.find(s => 
            s.key.toLowerCase() === event.key.toLowerCase() &&
            !!s.ctrl === (event.ctrlKey || event.metaKey) &&
            !!s.shift === event.shiftKey &&
            !!s.alt === event.altKey
        );

        if (shortcut) {
            // Allow clipboard operations to pass through to the editor
            if (['copy', 'cut', 'paste', 'select-all'].includes(shortcut.action)) {
                const isInEditor = target.closest('.jse-main') || 
                                 target.closest('.ace_editor') ||
                                 target.closest('.transform-input');
                
                if (isInEditor) {
                    // Let the editor handle clipboard operations naturally
                    return;
                }
            }
            
            event.preventDefault();
            event.stopPropagation();
            
            const callback = this.actions.get(shortcut.action);
            if (callback) {
                // Use requestAnimationFrame for better performance
                requestAnimationFrame(() => {
                    callback();
                });
            } else {
                console.warn(`No callback registered for action: ${shortcut.action}`);
            }
        }
    }

    registerAction(action: string, callback: () => void) {
        this.actions.set(action, callback);
    }

    unregisterAction(action: string) {
        this.actions.delete(action);
    }

    getShortcuts(): KeyboardShortcut[] {
        return [...this.shortcuts];
    }

    getShortcutForAction(action: string): KeyboardShortcut | undefined {
        return this.shortcuts.find(s => s.action === action);
    }

    formatShortcut(shortcut: KeyboardShortcut): string {
        const parts: string[] = [];
        
        if (shortcut.ctrl) parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
        if (shortcut.shift) parts.push('Shift');
        if (shortcut.alt) parts.push(navigator.platform.includes('Mac') ? '⌥' : 'Alt');
        
        parts.push(shortcut.key.toUpperCase());
        
        return parts.join(' + ');
    }
}

export const shortcutManager = new KeyboardShortcutManager();
export const showShortcutsModal = writable(false);