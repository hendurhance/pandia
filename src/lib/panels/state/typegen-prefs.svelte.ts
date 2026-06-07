import type { TypegenLang } from '$lib/ipc/types';
import { loadPersisted, savePersisted, TYPEGEN_FILE } from '$lib/util/persist';
import { PersistedStore } from '$lib/util/persisted-store.svelte';
import { oneOf } from '$lib/util/guards';

const STORE_FILE = TYPEGEN_FILE;
const STORE_KEY = 'activeLang';

const VALID_LANGS: TypegenLang[] = [
	'typescript',
	'rust',
	'go',
	'kotlin',
	'json-schema',
	'python',
	'php',
	'java',
	'zod',
];

const DEFAULT_LANG: TypegenLang = 'typescript';

function coerce(raw: unknown): TypegenLang {
	return oneOf(raw, VALID_LANGS) ? raw : DEFAULT_LANG;
}

class TypegenPrefs extends PersistedStore {
	activeLang: TypegenLang = $state(DEFAULT_LANG);

	protected async load(): Promise<void> {
		this.activeLang = coerce(await loadPersisted<string>(STORE_FILE, STORE_KEY));
	}

	setLang(lang: TypegenLang): void {
		if (this.activeLang === lang) return;
		this.activeLang = lang;
		void savePersisted(STORE_FILE, STORE_KEY, lang);
	}
}

export const typegenPrefs = new TypegenPrefs();

export const TYPEGEN_LANGS: ReadonlyArray<{ id: TypegenLang; label: string }> = [
	{ id: 'typescript', label: 'TypeScript' },
	{ id: 'rust', label: 'Rust' },
	{ id: 'go', label: 'Go' },
	{ id: 'kotlin', label: 'Kotlin' },
	{ id: 'json-schema', label: 'JSON Schema' },
	{ id: 'python', label: 'Python' },
	{ id: 'php', label: 'PHP' },
	{ id: 'java', label: 'Java' },
	{ id: 'zod', label: 'Zod' },
];
