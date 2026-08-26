import type { TypegenLang } from '$lib/ipc/bindings';
import { TYPEGEN_FILE } from '$lib/util/persist';
import { definePrefs, enumField } from '$lib/util/prefs.svelte';

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

const VALID_LANGS: TypegenLang[] = TYPEGEN_LANGS.map((t) => t.id);

const store = definePrefs({
	file: TYPEGEN_FILE,
	key: 'typegen',
	schema: {
		activeLang: enumField<TypegenLang>('typescript', VALID_LANGS),
	},
});

export const typegenPrefs = Object.assign(store, {
	setLang: (lang: TypegenLang) => void store.set('activeLang', lang),
});
