import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import type { SchemaValidationResult } from '$lib/ipc/bindings';
import { lastResult, schemaSessions } from './schema-store.svelte';

vi.mock('$lib/ipc/client', () => ({ ipc: { docValidateSchema: vi.fn() } }));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	SCHEMA_DEBOUNCE_MANUAL: -1,
	SCHEMA_DEBOUNCE_IMMEDIATE: 0,
	behaviorPrefs: { init: async () => {}, schemaDebounceMs: 500 },
}));

const VALID: SchemaValidationResult = { valid: true, errors: [], errorCount: 0, truncated: false };
const INVALID: SchemaValidationResult = {
	valid: false,
	errors: [{ instancePath: '/retries', schemaPath: '/properties', message: 'not an integer' }],
	errorCount: 1,
	truncated: false,
};
const H = 'h1' as never;

let tab = 0;
// Each test gets a tab whose schema was checked once and found invalid.
async function checkedSession() {
	const s = schemaSessions.for(`t${++tab}`);
	s.documentChanged(H, 1);
	vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce(INVALID);
	await s.load('{"type":"object"}', null);
	expect(s.verdict).toEqual({ kind: 'checked', result: INVALID });
	vi.mocked(ipc.docValidateSchema).mockClear();
	return s;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(ipc.docValidateSchema).mockReset();
	behaviorPrefs.schemaDebounceMs = 500;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SchemaSession', () => {
	it('re-checks an edited document after the delay, with no panel involved', async () => {
		const s = await checkedSession();
		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		s.documentChanged(H, 2);
		expect(s.verdict).toEqual({ kind: 'checking', last: INVALID });
		expect(ipc.docValidateSchema).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(500);
		expect(ipc.docValidateSchema).toHaveBeenCalledWith(H, '{"type":"object"}');
		expect(s.verdict).toEqual({ kind: 'checked', result: VALID });
	});

	it('marks the verdict out of date in manual mode, and checks only when asked', async () => {
		const s = await checkedSession();
		behaviorPrefs.schemaDebounceMs = -1;
		s.documentChanged(H, 2);
		await vi.advanceTimersByTimeAsync(5000);
		expect(ipc.docValidateSchema).not.toHaveBeenCalled();
		expect(s.verdict).toEqual({ kind: 'stale', last: INVALID });

		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		await s.validateNow();
		expect(s.verdict).toEqual({ kind: 'checked', result: VALID });
	});

	it('checks at once in immediate mode', async () => {
		const s = await checkedSession();
		behaviorPrefs.schemaDebounceMs = 0;
		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		s.documentChanged(H, 2);
		await vi.advanceTimersByTimeAsync(0);
		expect(ipc.docValidateSchema).toHaveBeenCalledTimes(1);
		expect(s.verdict.kind).toBe('checked');
	});

	it('keeps the newest check when an older one finishes later', async () => {
		const s = await checkedSession();
		behaviorPrefs.schemaDebounceMs = 0;
		let finishOld: (r: SchemaValidationResult) => void = () => {};
		vi.mocked(ipc.docValidateSchema)
			.mockReturnValueOnce(new Promise((r) => (finishOld = r)))
			.mockResolvedValueOnce(VALID);
		s.documentChanged(H, 2);
		s.documentChanged(H, 3);
		await vi.advanceTimersByTimeAsync(0);
		finishOld(INVALID);
		await vi.advanceTimersByTimeAsync(0);
		expect(s.verdict).toEqual({ kind: 'checked', result: VALID });
	});

	it('clearing the schema cancels a pending check', async () => {
		const s = await checkedSession();
		s.documentChanged(H, 2);
		s.clear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(ipc.docValidateSchema).not.toHaveBeenCalled();
		expect(s.verdict).toEqual({ kind: 'none' });
		expect(s.text).toBe('');
	});

	it('does not re-check a schema that cannot be used until its text changes', async () => {
		const s = schemaSessions.for(`t${++tab}`);
		s.documentChanged(H, 1);
		vi.mocked(ipc.docValidateSchema).mockRejectedValueOnce(new Error('This schema is broken.'));
		await s.load('{"type": 12}', null);
		expect(s.verdict).toEqual({ kind: 'problem', message: 'This schema is broken.' });

		s.documentChanged(H, 2);
		await vi.advanceTimersByTimeAsync(1000);
		expect(ipc.docValidateSchema).toHaveBeenCalledTimes(1);

		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		s.setText('{"type":"object"}');
		await vi.advanceTimersByTimeAsync(500);
		expect(s.verdict).toEqual({ kind: 'checked', result: VALID });
	});

	it('settles an unchecked verdict by checking first, even in manual mode', async () => {
		const s = await checkedSession();
		behaviorPrefs.schemaDebounceMs = -1;
		s.documentChanged(H, 2);
		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		expect(await s.settleVerdict()).toEqual({ kind: 'checked', result: VALID });
	});

	it('checks a schema pasted before the tab had a document once the document arrives', async () => {
		const s = schemaSessions.for(`t${++tab}`);
		s.setText('{"type":"object"}');
		await vi.advanceTimersByTimeAsync(500);
		vi.mocked(ipc.docValidateSchema).mockResolvedValue(VALID);
		s.documentChanged(H, 1);
		await vi.advanceTimersByTimeAsync(500);
		expect(s.verdict).toEqual({ kind: 'checked', result: VALID });
	});

	it('checks again when the tab holds a different document at the same version', async () => {
		const s = await checkedSession();
		s.documentChanged('h2' as never, 1);
		expect(s.verdict.kind).not.toBe('checked');
	});

	it('gives readers the last finished result while a new check is out', async () => {
		const s = await checkedSession();
		s.documentChanged(H, 2);
		expect(lastResult(s.verdict)).toEqual(INVALID);
		expect(lastResult({ kind: 'none' })).toBeNull();
	});
});
