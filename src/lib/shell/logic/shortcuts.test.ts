// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SHORTCUTS } from '$lib/ipc/bindings';
import { buildShellCommands, type ShellCommandDeps } from './app-commands';
import { createDocPaneCommands } from '$lib/docpane/logic/doc-pane-commands';
import type { DocPaneActions } from '$lib/docpane/logic/doc-actions';
import { matchShortcut, shortcutKeys } from './shortcuts';

vi.mock('$lib/util/platform', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/util/platform')>()),
	isMac: false,
}));

function key(code: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		code,
		ctrlKey: true,
		shiftKey: false,
		metaKey: false,
		altKey: false,
		...mods,
	} as KeyboardEvent;
}

describe('the shortcut table', () => {
	it('names a registered command in every row', () => {
		const ids = new Set(
			[
				...buildShellCommands({ isDev: false } as ShellCommandDeps),
				...createDocPaneCommands({} as DocPaneActions),
			].map((c) => c.id),
		);
		expect(SHORTCUTS.filter((s) => !ids.has(s.command)).map((s) => s.command)).toEqual([]);
	});

	it.each(['mac', 'notMac'] as const)('uses each key combination once on %s', (platform) => {
		const combos = SHORTCUTS.filter((s) => s.platform === 'all' || s.platform === platform).map(
			(s) => `${s.alt ? 'Alt+' : ''}${s.shift ? 'Shift+' : ''}${s.key}`,
		);
		expect(new Set(combos).size).toBe(combos.length);
	});

	it('labels a command with its keys', () => {
		expect(shortcutKeys('doc.saveAs')).toBe('⌘⇧S');
		expect(shortcutKeys('tab.next')).toBe('⌘⇧]');
		expect(shortcutKeys('find.replace')).toBe('⌘H');
		expect(shortcutKeys('tree.expandAll')).toBeNull();
	});

	it('labels Find and Replace with the macOS keys on macOS', async () => {
		vi.resetModules();
		vi.doMock('$lib/util/platform', async (importOriginal) => ({
			...(await importOriginal<typeof import('$lib/util/platform')>()),
			isMac: true,
		}));
		const mac = await import('./shortcuts');
		expect(mac.shortcutKeys('find.replace')).toBe('⌘⌥F');
		expect(mac.shortcutKeys('doc.saveAs')).toBe('⌘⇧S');
		vi.doUnmock('$lib/util/platform');
	});
});

describe('matchShortcut — Ctrl shortcuts off macOS', () => {
	it('finds the command for letter, digit and punctuation keys', () => {
		expect(matchShortcut(key('KeyS', { shiftKey: true }))).toBe('doc.saveAs');
		expect(matchShortcut(key('Digit2'))).toBe('view.code');
		expect(matchShortcut(key('BracketRight', { shiftKey: true }))).toBe('tab.next');
		expect(matchShortcut(key('Comma'))).toBe('nav.settings');
		expect(matchShortcut(key('Slash'))).toBe('help.shortcuts');
		expect(matchShortcut(key('KeyH'))).toBe('find.replace');
	});

	it('ignores keys without Ctrl, with Alt, macOS-only keys, or keys with no shortcut', () => {
		expect(matchShortcut(key('KeyS', { ctrlKey: false }))).toBeNull();
		expect(matchShortcut(key('KeyS', { altKey: true }))).toBeNull();
		expect(matchShortcut(key('KeyF', { altKey: true }))).toBeNull();
		expect(matchShortcut(key('KeyJ'))).toBeNull();
	});
});

describe('matchShortcut — keyboard layouts', () => {
	it('matches letters by the key they type, so AZERTY Ctrl+Z undoes instead of closing the tab', () => {
		expect(matchShortcut(key('KeyW', { key: 'z' }))).toBe('doc.undo');
		expect(matchShortcut(key('KeyZ', { key: 'w' }))).toBe('tab.close');
		expect(matchShortcut(key('KeyW', { key: 'Z', shiftKey: true }))).toBe('doc.redo');
	});

	it('keeps digits, punctuation and non-Latin letters on their physical keys', () => {
		expect(matchShortcut(key('Digit1', { key: '&' }))).toBe('view.tree');
		expect(matchShortcut(key('Comma', { key: ';' }))).toBe('nav.settings');
		expect(matchShortcut(key('KeyZ', { key: 'я' }))).toBe('doc.undo');
	});
});

describe('matchShortcut — in a text field', () => {
	// jsdom has no isContentEditable.
	Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
		get(this: HTMLElement) {
			return this.closest('[contenteditable="true"]') !== null;
		},
	});
	const editable = document.createElement('div');
	editable.setAttribute('contenteditable', 'true');
	const fields = [
		['input', document.createElement('input')],
		['textarea', document.createElement('textarea')],
		['contenteditable', editable],
	] as const;

	it.each(fields)('leaves undo, redo and plain paste to a focused %s', (_, target) => {
		expect(matchShortcut(key('KeyZ', { target }))).toBeNull();
		expect(matchShortcut(key('KeyZ', { shiftKey: true, target }))).toBeNull();
		expect(matchShortcut(key('KeyV', { shiftKey: true, target }))).toBeNull();
	});

	it.each(fields)('still runs other app shortcuts from a focused %s', (_, target) => {
		expect(matchShortcut(key('KeyS', { target }))).toBe('doc.save');
		expect(matchShortcut(key('KeyK', { target }))).toBe('palette.toggle');
	});

	it('runs undo, redo and the schema panel outside text fields', () => {
		const target = document.createElement('div');
		expect(matchShortcut(key('KeyZ', { target }))).toBe('doc.undo');
		expect(matchShortcut(key('KeyZ', { shiftKey: true, target }))).toBe('doc.redo');
		expect(matchShortcut(key('KeyV', { shiftKey: true, target }))).toBe('view.openSchemaPanel');
	});
});
