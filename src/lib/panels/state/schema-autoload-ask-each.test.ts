import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { ipc } from '$lib/ipc/client';
import { ConfirmController } from '$lib/ui/confirm.svelte';
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

function doc(tabId: string, handle: string, path: string, cliSchema: string | null = null) {
	return { tabId, handle: handle as never, version: 1, path, rootIsObject: true, cliSchema };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
});

describe('autoloadSchema: remote $schema prompts', () => {
	it('asks about every document URL when two documents open at once', async () => {
		vi.mocked(ipc.docGetValue).mockImplementation(
			async (h) =>
				JSON.stringify(h === 'A' ? 'https://a.dev/s.json' : 'https://b.dev/s.json') as never,
		);
		vi.mocked(fetch).mockImplementation(async () => new Response('{"type":"object"}'));
		const confirm = new ConfirmController();
		const asked: string[] = [];
		const confirmSchemaFetch = async (host: string) => {
			asked.push(host);
			return (
				(await confirm.ask({ title: 'load?', message: host, primaryLabel: 'load' })) === 'primary'
			);
		};

		const a = autoloadSchema(doc('two-a', 'A', '/w/a.json'), confirmSchemaFetch);
		const b = autoloadSchema(doc('two-b', 'B', '/w/b.json'), confirmSchemaFetch);
		await vi.waitFor(() => expect(asked).toHaveLength(2));
		for (let i = 0; i < 2 && confirm.state; i++) {
			confirm.pick('primary');
			await new Promise((r) => setTimeout(r, 0));
		}
		await Promise.all([a, b]);

		expect([schemaSessions.for('two-a').text, schemaSessions.for('two-b').text]).toEqual([
			'{"type":"object"}',
			'{"type":"object"}',
		]);
	});
});
