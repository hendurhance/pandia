import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { ipc } from '$lib/ipc/client';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { autoloadSchema } from './schema-autoload';
import { schemaSessions } from './schema-store.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: { docGetValue: vi.fn(), readSchemaFile: vi.fn(), docValidateSchema: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	SCHEMA_DEBOUNCE_MANUAL: -1,
	SCHEMA_DEBOUNCE_IMMEDIATE: 0,
	behaviorPrefs: { init: async () => {}, schemaDebounceMs: 500, allowHttpSchemas: false },
}));

const VALID = { valid: true, errors: [], errorCount: 0, truncated: false };

function doc(tabId: string, path: string, cliSchema: string | null = null) {
	return { tabId, handle: 'h' as never, version: 1, path, rootIsObject: true, cliSchema };
}

function docSchema(ref: string | null) {
	vi.mocked(ipc.docGetValue).mockImplementation(async () => {
		if (ref === null) throw new Error('no $schema');
		return JSON.stringify(ref) as never;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
	behaviorPrefs.allowHttpSchemas = false;
});

describe('autoloadSchema', () => {
	it('asks before downloading a document URL, then validates; a second open does not ask', async () => {
		docSchema('https://x.dev/s.json');
		vi.mocked(fetch).mockResolvedValue(new Response('{"type":"object"}'));
		const confirm = vi.fn(async () => true);

		await autoloadSchema(doc('t1', '/w/a.json'), confirm);
		expect(confirm).toHaveBeenCalledWith('x.dev');
		expect(schemaSessions.for('t1')).toMatchObject({
			text: '{"type":"object"}',
			verdict: { kind: 'checked', result: VALID },
			origin: { from: 'document', ref: 'https://x.dev/s.json' },
		});

		await autoloadSchema(doc('t2', '/w/b.json'), confirm);
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	it('loads nothing when the user declines, but still shows where the schema points', async () => {
		docSchema('https://y.dev/s.json');
		await autoloadSchema(doc('t3', '/w/a.json'), async () => false);
		expect(fetch).not.toHaveBeenCalled();
		expect(schemaSessions.for('t3')).toMatchObject({
			text: '',
			verdict: { kind: 'none' },
			origin: { from: 'document' },
		});
	});

	it('refuses http unless the setting allows it, without asking', async () => {
		docSchema('http://x.dev/s.json');
		const confirm = vi.fn(async () => true);
		await autoloadSchema(doc('t4', '/w/a.json'), confirm);
		expect(confirm).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
		expect(schemaSessions.for('t4').verdict).toMatchObject({
			kind: 'problem',
			message: expect.stringMatching(/only loads schemas over HTTPS/),
		});
	});

	it('uses --schema without asking and notes the document reference it replaced', async () => {
		docSchema('./other.json');
		vi.mocked(ipc.readSchemaFile).mockResolvedValue('{}');
		const confirm = vi.fn(async () => true);
		await autoloadSchema(doc('t5', '/w/c.json', '/w/cli.schema.json'), confirm);
		expect(confirm).not.toHaveBeenCalled();
		expect(ipc.readSchemaFile).toHaveBeenCalledWith('/w/cli.schema.json');
		expect(schemaSessions.for('t5').origin).toEqual({
			from: 'cli',
			ref: '/w/cli.schema.json',
			ignoredDocRef: './other.json',
		});
	});

	it('shows a load error instead of falling back to the other source', async () => {
		docSchema('./missing.json');
		vi.mocked(ipc.readSchemaFile).mockRejectedValue(new Error('Could not open missing.json.'));
		await autoloadSchema(doc('t6', '/w/a.json'), async () => true);
		expect(schemaSessions.for('t6')).toMatchObject({
			text: '',
			verdict: { kind: 'problem', message: 'Could not open missing.json.' },
		});
		expect(ipc.docValidateSchema).not.toHaveBeenCalled();
	});
});
