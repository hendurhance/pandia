// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/svelte';
import type { DocContext } from '$lib/shell/state/workspace.svelte';
import { schemaSessions } from './state/schema-store.svelte';
import SchemaPanel from './SchemaPanel.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docChildCount: vi.fn(), docValidateSchema: vi.fn() } }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

const REJECTED = {
	valid: false,
	errors: [
		{
			instancePath: '',
			schemaPath: '/additionalProperties',
			message: "Additional properties are not allowed ('$schema' was unexpected)",
		},
	],
	errorCount: 1,
	truncated: false,
};

describe('SchemaPanel: the additionalProperties hint', () => {
	it('shows the hint when the schema came from the document’s $schema', async () => {
		const s = schemaSessions.for('hint-doc');
		s.text = '{"additionalProperties": false}';
		s.origin = { from: 'document', ref: './config.schema.json', ignoredDocRef: null };
		s.verdict = { kind: 'checked', result: REJECTED };
		const { container } = render(SchemaPanel, {
			props: { tabId: 'hint-doc', context: { handle: 'h' } as unknown as DocContext },
		});
		expect(within(container).queryByText(/doesn't allow the document's/)).not.toBeNull();
	});

	it('shows the hint when --schema rejects the document’s own $schema key', async () => {
		const s = schemaSessions.for('hint-cli');
		s.text = '{"additionalProperties": false}';
		s.origin = { from: 'cli', ref: '/w/s.json', ignoredDocRef: './config.schema.json' };
		s.verdict = { kind: 'checked', result: REJECTED };
		const { container } = render(SchemaPanel, {
			props: { tabId: 'hint-cli', context: { handle: 'h' } as unknown as DocContext },
		});
		expect(within(container).queryByText(/doesn't allow the document's/)).not.toBeNull();
	});
});
