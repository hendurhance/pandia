import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import type { SchemaValidationResult } from '$lib/ipc/bindings';
import { schemaSessions } from './schema-store.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docValidateSchema: vi.fn() } }));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	SCHEMA_DEBOUNCE_MANUAL: -1,
	SCHEMA_DEBOUNCE_IMMEDIATE: 0,
	behaviorPrefs: { init: async () => {}, schemaDebounceMs: 500 },
}));

const VALID: SchemaValidationResult = { valid: true, errors: [], errorCount: 0, truncated: false };
const INVALID: SchemaValidationResult = {
	valid: false,
	errors: [{ instancePath: '/host', schemaPath: '/properties/host/type', message: 'not a string' }],
	errorCount: 1,
	truncated: false,
};
const H = 'h1' as never;

let tab = 0;

function manualSessionWithCheckRunning() {
	const s = schemaSessions.for(`race-${++tab}`);
	s.documentChanged(H, 1);
	behaviorPrefs.schemaDebounceMs = -1;
	s.setText('{"properties":{"host":{"type":"string"}}}');
	let finish!: (r: SchemaValidationResult) => void;
	vi.mocked(ipc.docValidateSchema).mockReturnValueOnce(new Promise((r) => (finish = r)));
	const running = s.validateNow();
	expect(s.verdict.kind).toBe('checking');
	return { s, running, finish: (r: SchemaValidationResult) => finish(r) };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(ipc.docValidateSchema).mockReset();
	behaviorPrefs.schemaDebounceMs = 500;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SchemaSession: a check that finishes after a newer change', () => {
	it('manual mode: a document edit made while a check runs stays "out of date"', async () => {
		const { s, running, finish } = manualSessionWithCheckRunning();
		s.documentChanged(H, 2);
		expect(s.verdict.kind).toBe('stale');

		finish(INVALID);
		await running;
		expect(s.verdict.kind).toBe('stale');
	});

	it('manual mode: --wait settles on the edited document, not the pre-edit result', async () => {
		const { s, running, finish } = manualSessionWithCheckRunning();
		s.documentChanged(H, 2);
		finish(INVALID);
		await running;

		vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce(VALID);
		const settled = await s.settleVerdict();
		expect(settled).toEqual({ kind: 'checked', result: VALID });
	});

	it('manual mode: a schema edit made while a check runs stays "out of date"', async () => {
		const { s, running, finish } = manualSessionWithCheckRunning();
		s.setText('{"properties":{"host":{"type":"number"}}}');
		expect(s.verdict.kind).toBe('stale');

		finish(VALID);
		await running;
		expect(s.verdict.kind).toBe('stale');
	});

	it('default 500 ms mode: emptying the schema box while a check runs leaves no result behind', async () => {
		const s = schemaSessions.for(`race-${++tab}`);
		s.documentChanged(H, 1);
		let finish!: (r: SchemaValidationResult) => void;
		vi.mocked(ipc.docValidateSchema).mockReturnValueOnce(new Promise((r) => (finish = r)));
		s.setText('{"properties":{"host":{"type":"string"}}}');
		await vi.advanceTimersByTimeAsync(500);
		expect(ipc.docValidateSchema).toHaveBeenCalledTimes(1);
		s.setText('');
		finish(INVALID);
		await vi.advanceTimersByTimeAsync(0);
		expect(s.verdict).toEqual({ kind: 'none' });
	});

	it('emptying the schema box while a check runs leaves no result behind', async () => {
		const { s, running, finish } = manualSessionWithCheckRunning();
		s.setText('');
		expect(s.verdict).toEqual({ kind: 'none' });

		finish(INVALID);
		await running;
		expect(s.verdict).toEqual({ kind: 'none' });
	});
});
