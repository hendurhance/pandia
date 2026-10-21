// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { IpcError } from '$lib/ipc/error';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import { fetch } from '@tauri-apps/plugin-http';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { autoloadSchema } from './state/schema-autoload';
import { schemaSessions } from './state/schema-store.svelte';
import SchemaPanel from './SchemaPanel.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docChildCount: vi.fn(),
		docGetValue: vi.fn(),
		docValidateSchema: vi.fn(async () => ({
			valid: true,
			errors: [],
			errorCount: 0,
			truncated: false,
		})),
	},
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

describe('SchemaPanel', () => {
	it('jumps to an object key that looks like a number', async () => {
		// {"users": {"123": {"age": "x"}}}: "123" is a key, so the index form is not a path.
		vi.mocked(ipc.docChildCount).mockImplementation(async (_h, path) => {
			if (typeof path[1] === 'number') throw new IpcError('invalidPath', 'invalid path', { path });
			return 1;
		});
		schemaSessions.for('t1').text = '{"type":"object"}';
		schemaSessions.for('t1').verdict = {
			kind: 'checked',
			result: {
				valid: false,
				errors: [{ instancePath: '/users/123/age', schemaPath: '/type', message: 'not a number' }],
				errorCount: 1,
				truncated: false,
			},
		};
		const onJump = vi.fn();
		const { getByTitle } = render(SchemaPanel, {
			props: { tabId: 't1', context: { handle: 'h' } as unknown as DocContext, onJump },
		});
		await fireEvent.click(getByTitle('jump to /users/123/age'));
		await vi.waitFor(() => expect(onJump).toHaveBeenCalledWith(['users', '123', 'age']));
	});

	it('loads an http schema once the user allows http schemas', async () => {
		vi.mocked(ipc.docGetValue).mockResolvedValue('"http://x.dev/s.json"' as never);
		vi.mocked(fetch).mockResolvedValue(new Response('{"type":"object"}'));
		const doc = {
			tabId: 't2',
			handle: 'h' as never,
			version: 1,
			path: '/w/a.json',
			rootIsObject: true,
			cliSchema: null,
		};
		await autoloadSchema(doc, async () => true);
		const schema = schemaSessions.for('t2');
		expect(schema.verdict.kind).toBe('problem');

		render(SchemaPanel, {
			props: { tabId: 't2', context: { handle: 'h', version: 1 } as unknown as DocContext },
		});
		await behaviorPrefs.setAllowHttpSchemas(true);
		await vi.waitFor(() => expect(schema.verdict.kind).toBe('checked'));
		expect(schema.text).toBe('{"type":"object"}');
	});
});
