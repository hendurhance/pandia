import { SHORTCUTS } from '$lib/ipc/bindings';
import { fmtKbd, isMac } from '$lib/util/platform';

export type ShortcutCommand = (typeof SHORTCUTS)[number]['command'];

const PUNCTUATION_CODES: Record<string, string> = {
	',': 'Comma',
	'/': 'Slash',
	'[': 'BracketLeft',
	']': 'BracketRight',
};

function keyCode(key: string): string {
	if (/^[0-9]$/.test(key)) return `Digit${key}`;
	return PUNCTUATION_CODES[key] ?? `Key${key}`;
}

const HERE = SHORTCUTS.filter((s) => s.platform === 'all' || (s.platform === 'mac') === isMac);

const combo = (alt: boolean, shift: boolean, code: string) =>
	(alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + code;

const COMMAND_BY_COMBO = new Map<string, string>(
	HERE.map((s) => [combo(s.alt, s.shift, keyCode(s.key)), s.command]),
);

const KEYS_BY_COMMAND = new Map<string, string>(
	HERE.map((s) => [s.command, `⌘${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.key}`]),
);

const TEXT_FIELD_COMBOS = new Set(['KeyZ', 'Shift+KeyZ', 'Shift+KeyV']);

function isTextField(el: EventTarget | null): boolean {
	return (
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		(el instanceof HTMLElement && el.isContentEditable)
	);
}

function typedKeyCode(e: KeyboardEvent): string {
	return /^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : e.code;
}

export function matchShortcut(e: KeyboardEvent): string | null {
	if (isMac) return null;
	if (!e.ctrlKey || e.metaKey) return null;
	const pressed = combo(e.altKey, e.shiftKey, typedKeyCode(e));
	if (TEXT_FIELD_COMBOS.has(pressed) && isTextField(e.target)) return null;
	return COMMAND_BY_COMBO.get(pressed) ?? null;
}

export function shortcutKeys(command: string): string | null {
	return KEYS_BY_COMMAND.get(command) ?? null;
}

export function shortcutLabel(command: ShortcutCommand): string {
	return fmtKbd(KEYS_BY_COMMAND.get(command)!);
}
