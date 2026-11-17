import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { ipc } from '$lib/ipc/client';
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

function slowCliDoc(tabId: string) {
	return {
		tabId,
		handle: 'T' as never,
		version: 1,
		path: '/w/t.json',
		rootIsObject: true,
		cliSchema: 'https://slow.dev/s.json',
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
	vi.mocked(ipc.docGetValue).mockRejectedValue(new Error('no $schema'));
});

describe('autoloadSchema: a schema typed during a slow download', () => {
	it('is not replaced when the download arrives', async () => {
		let respond!: (r: Response) => void;
		vi.mocked(fetch).mockReturnValueOnce(new Promise((r) => (respond = r)));
		const loading = autoloadSchema(slowCliDoc('typed-ok'), async () => true);
		const schema = schemaSessions.for('typed-ok');
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		schema.setText('{"type":"array"}');

		respond(new Response('{"type":"object"}'));
		await loading;
		expect(schema.text).toBe('{"type":"array"}');
	});

	it('is not wiped when the download fails', async () => {
		let fail!: (e: Error) => void;
		vi.mocked(fetch).mockReturnValueOnce(new Promise((_, r) => (fail = r)));
		const loading = autoloadSchema(slowCliDoc('typed-fail'), async () => true);
		const schema = schemaSessions.for('typed-fail');
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		schema.setText('{"type":"array"}');

		fail(new Error('offline'));
		await loading;
		expect(schema.text).toBe('{"type":"array"}');
		expect(schema.verdict.kind).not.toBe('problem');
	});
});
