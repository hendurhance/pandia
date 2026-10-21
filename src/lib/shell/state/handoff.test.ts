import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { schemaSessions } from '$lib/panels/state/schema-store.svelte';
import type { PendingFile, SchemaValidationResult, TabReport } from '$lib/ipc/bindings';
import { Handoff } from './handoff';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		cliWaitDone: vi.fn(async () => {}),
		cliDiscardPiped: vi.fn(async () => {}),
		cliReply: vi.fn(async () => {}),
		docValidateSchema: vi.fn(),
	},
}));
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

async function checked(tabId: string, result: SchemaValidationResult) {
	const schema = schemaSessions.for(tabId);
	schema.documentChanged('h' as never, 1);
	vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce(result);
	await schema.load('{"type":"object"}', null);
	return schema;
}

function launch(extra: Partial<PendingFile>): PendingFile {
	return {
		path: '/w/a.json',
		piped: false,
		schema: null,
		compareWith: null,
		wait: null,
		reply: null,
		...extra,
	};
}

function report(extra: Partial<TabReport>): TabReport {
	return {
		path: '/w/a.json',
		opened: true,
		saved: false,
		valid: null,
		errorCount: 0,
		errors: [],
		problem: null,
		...extra,
	};
}

const WAIT = '/tmp/pandia-wait-1';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Handoff', () => {
	it('exists only for launches that carry something beyond the file', () => {
		expect(Handoff.needed(launch({}))).toBe(false);
		expect(Handoff.needed(launch({ wait: WAIT }))).toBe(true);
		expect(Handoff.needed(launch({ piped: true }))).toBe(true);
		expect(Handoff.needed(launch({ schema: '/w/s.json' }))).toBe(true);
		expect(Handoff.needed(launch({ compareWith: '/w/b.json' }))).toBe(true);
	});

	it('gives the pane its --schema and --diff instructions exactly once', () => {
		const h = new Handoff(launch({ schema: '/w/s.json', compareWith: '/w/b.json' }));
		expect(h.takeInstructions()).toEqual({ schema: '/w/s.json', compareWith: '/w/b.json' });
		expect(h.takeInstructions()).toBeNull();
	});

	it('owes its tab only while a report or a temp file is outstanding', async () => {
		expect(new Handoff(launch({ schema: '/w/s.json' })).owes).toBe(false);
		const waiting = new Handoff(launch({ wait: WAIT }));
		expect(waiting.owes).toBe(true);
		await waiting.settle('t0');
		expect(waiting.owes).toBe(false);
	});

	it('reports a saved, opened file once', async () => {
		const h = new Handoff(launch({ wait: WAIT }));
		h.opened();
		h.recordSave();
		await h.settle('t1');
		await h.settle('t1');
		expect(ipc.cliWaitDone).toHaveBeenCalledTimes(1);
		expect(ipc.cliWaitDone).toHaveBeenCalledWith(WAIT, report({ saved: true }));
	});

	it('reports schema errors as JSON Pointers, and a schema that failed to load', async () => {
		await checked('t2', INVALID);
		const invalid = new Handoff(launch({ wait: WAIT }));
		invalid.opened();
		await invalid.settle('t2');
		expect(ipc.cliWaitDone).toHaveBeenLastCalledWith(
			WAIT,
			report({
				valid: false,
				errorCount: 1,
				errors: [{ pointer: '/retries', message: 'not an integer' }],
			}),
		);

		schemaSessions.for('t3').fail("This schema can't be used.", null);
		const broken = new Handoff(launch({ wait: WAIT }));
		broken.opened();
		await broken.settle('t3');
		expect(ipc.cliWaitDone).toHaveBeenLastCalledWith(
			WAIT,
			report({ problem: "This schema can't be used." }),
		);
	});

	it('checks an edit made since the last check before reporting', async () => {
		const schema = await checked('t8', VALID);
		schema.documentChanged('h' as never, 2);
		vi.mocked(ipc.docValidateSchema).mockResolvedValueOnce(INVALID);
		const h = new Handoff(launch({ wait: WAIT }));
		h.opened();
		await h.settle('t8');
		expect(ipc.cliWaitDone).toHaveBeenLastCalledWith(
			WAIT,
			report({
				valid: false,
				errorCount: 1,
				errors: [{ pointer: '/retries', message: 'not an integer' }],
			}),
		);
	});

	it('reports why the file did not open, or that the tab closed first', async () => {
		const failed = new Handoff(launch({ wait: WAIT }));
		failed.failed('There’s no file at that path.');
		await failed.settle('t4');
		expect(ipc.cliWaitDone).toHaveBeenLastCalledWith(
			WAIT,
			report({ opened: false, problem: 'There’s no file at that path.' }),
		);

		const early = new Handoff(launch({ wait: WAIT }));
		await early.settle('t5');
		expect(ipc.cliWaitDone).toHaveBeenLastCalledWith(
			WAIT,
			report({ opened: false, problem: 'The tab closed before the file finished opening.' }),
		);
	});

	it('sends piped input back to the terminal and counts that as saved', async () => {
		const h = new Handoff(
			launch({
				piped: true,
				path: '/tmp/pandia-stdin-1.json',
				wait: WAIT,
				reply: '/tmp/pandia-reply-1.json',
			}),
		);
		expect(h.repliesToTerminal).toBe(true);
		h.opened();
		await h.sendBack('doc-1' as never);
		expect(ipc.cliReply).toHaveBeenCalledWith('doc-1', '/tmp/pandia-reply-1.json');

		await h.settle('t6');
		expect(ipc.cliDiscardPiped).toHaveBeenCalledWith('/tmp/pandia-stdin-1.json');
		expect(ipc.cliWaitDone).toHaveBeenCalledWith(WAIT, report({ path: null, saved: true }));
	});

	it('answers a launch that never got a tab and deletes its piped input', async () => {
		const h = new Handoff(launch({ piped: true, path: '/tmp/pandia-stdin-2.json', wait: WAIT }));
		await h.abandon('Pandia already has 10 tabs open.');
		expect(ipc.cliWaitDone).toHaveBeenCalledWith(
			WAIT,
			report({ path: null, opened: false, problem: 'Pandia already has 10 tabs open.' }),
		);
		expect(ipc.cliDiscardPiped).toHaveBeenCalledWith('/tmp/pandia-stdin-2.json');
	});

	it('sends nothing for a launch nobody waits on', async () => {
		const h = new Handoff(launch({ schema: '/w/s.json' }));
		h.opened();
		await h.settle('t7');
		expect(ipc.cliWaitDone).not.toHaveBeenCalled();
		expect(ipc.cliDiscardPiped).not.toHaveBeenCalled();
	});
});
