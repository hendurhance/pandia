// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { schemaSessions } from '$lib/panels/state/schema-store.svelte';
import { commandRegistry } from '$lib/palette/state/command-store.svelte';
import { Handoff } from '$lib/shell/state/handoff';
import type { TabSlot } from '$lib/shell/state/workspace.svelte';
import type { OpenOutcome, Summary } from '$lib/ipc/bindings';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docOpen: vi.fn(),
		docSummary: vi.fn(),
		docClose: vi.fn(async () => {}),
		cancelJob: vi.fn(async () => true),
		docCanonicalText: vi.fn(async () => '{}'),
		docCanonicalOffsets: vi.fn(async () => []),
		docGetSlice: vi.fn(async () => []),
		docColumnSchema: vi.fn(async () => null),
		docBackupClear: vi.fn(async () => {}),
		e2eRecord: vi.fn(async () => {}),
		cliWaitDone: vi.fn(async () => {}),
		docDiff: vi.fn(async () => []),
		docGetValue: vi.fn(),
		readSchemaFile: vi.fn(async () => '{"type":"object"}'),
		docValidateSchema: vi.fn(async () => ({
			valid: true,
			errors: [],
			errorCount: 0,
			truncated: false,
		})),
	},
}));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollTo = () => {};

function summary(over: Partial<Summary>): Summary {
	return {
		rootKind: 'object',
		rootChildCount: 0,
		sourcePath: null,
		sourceSize: 20,
		lazy: false,
		version: 1,
		dirty: false,
		fileBacked: false,
		recoveryNote: null,
		commentsStripped: false,
		...over,
	};
}

function opened(handle: string, over: Partial<Summary>): OpenOutcome {
	return {
		kind: 'opened',
		handle: handle as never,
		summary: summary(over),
		notes: { convertedFrom: null, repairs: [] },
	};
}

function docSchemas(byHandle: Record<string, string>) {
	vi.mocked(ipc.docGetValue).mockImplementation(async (h) => {
		const ref = byHandle[h as unknown as string];
		if (ref === undefined) throw new Error('no such key');
		return JSON.stringify(ref) as never;
	});
}

function slotWith(handoff: Handoff | null = null): TabSlot {
	return {
		register: () => () => {},
		handoff,
		isHandleAlive: () => true,
		versionOf: () => null,
		resolveUnsaved: async () => true,
	} as unknown as TabSlot;
}

beforeEach(() => {
	vi.mocked(ipc.docOpen).mockReset();
	vi.mocked(ipc.readSchemaFile).mockClear();
	vi.mocked(ipc.docValidateSchema).mockClear();
});

describe('DocPane: schema autoload', () => {
	it("a file opened into a tab after Close Document doesn't inherit the last file's schema", async () => {
		docSchemas({ A: './a.schema.json' });
		vi.mocked(ipc.docOpen)
			.mockResolvedValueOnce(opened('A', { sourcePath: '/w/a.json', fileBacked: true }))
			.mockResolvedValueOnce(opened('B', { sourcePath: '/w/b.json', fileBacked: true }));
		const { container, rerender } = render(DocPane, {
			props: {
				tabId: 'leak-tab',
				slot: slotWith(),
				isActive: true,
				pendingOpen: { kind: 'file', path: '/w/a.json' },
			},
		});
		const schema = schemaSessions.for('leak-tab');
		await vi.waitFor(() =>
			expect(schema.origin).toMatchObject({ from: 'document', ref: './a.schema.json' }),
		);

		commandRegistry.run('doc.close');
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).toBeNull());

		await rerender({ pendingOpen: { kind: 'file', path: '/w/b.json' } });
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		await new Promise((r) => setTimeout(r, 700));

		const validatedB = vi.mocked(ipc.docValidateSchema).mock.calls.some(([h]) => h === 'B');
		expect({ origin: schema.origin, validatedB }).toEqual({ origin: null, validatedB: false });
	});

	it('a repaired copy of a file never reads a relative $schema from the app’s working folder', async () => {
		docSchemas({ R: './config.schema.json' });
		vi.mocked(ipc.docOpen).mockResolvedValueOnce(
			opened('R', { sourcePath: 'broken.repaired.json', fileBacked: false }),
		);
		render(DocPane, {
			props: {
				tabId: 'repaired-tab',
				slot: slotWith(),
				isActive: false,
				pendingOpen: { kind: 'file', path: '/w/broken.json' },
			},
		});
		const schema = schemaSessions.for('repaired-tab');
		await vi.waitFor(() => expect(schema.origin).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		const paths = vi.mocked(ipc.readSchemaFile).mock.calls.map(([p]) => p);
		expect(paths.filter((p) => !p.startsWith('/'))).toEqual([]);
	});

	it('pasted JSON with a relative $schema says it has no folder instead of reading one', async () => {
		docSchemas({ P: './s.json' });
		vi.mocked(ipc.docOpen).mockResolvedValueOnce(
			opened('P', { sourcePath: 'pasted.json', fileBacked: false }),
		);
		const { container } = render(DocPane, {
			props: { tabId: 'pasted-tab', slot: slotWith(), isActive: false },
		});
		const box = container.querySelector('textarea.paste') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: '{"$schema": "./s.json"}' } });
		await fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
		const schema = schemaSessions.for('pasted-tab');
		await vi.waitFor(() => expect(schema.origin).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		expect(ipc.readSchemaFile).not.toHaveBeenCalled();
		expect(schema.verdict).toMatchObject({
			kind: 'problem',
			message: expect.stringMatching(/isn't saved in a folder/),
		});
	});

	it('--schema still applies after the user repairs a file that failed to open', async () => {
		const handoff = new Handoff({
			path: '/w/broken.json',
			piped: false,
			schema: '/w/s.json',
			compareWith: null,
			wait: null,
			reply: null,
		});
		docSchemas({});
		vi.mocked(ipc.docOpen)
			.mockResolvedValueOnce({
				kind: 'failed',
				detail: 'trailing comma',
				tooLargeToFix: false,
				diagnosis: {
					title: 'trailing comma',
					detail: 'Remove the comma.',
					excerpt: null,
					fix: { label: 'Repair and load', text: '{"host":"x"}', warnings: [] },
				},
			})
			.mockResolvedValueOnce(opened('F', { sourcePath: 'broken.json', fileBacked: false }));
		const { container } = render(DocPane, {
			props: {
				tabId: 'fix-tab',
				slot: slotWith(handoff),
				isActive: false,
				pendingOpen: { kind: 'file', path: '/w/broken.json' },
			},
		});
		const pane = within(container);
		const fixButton = await pane.findByText('Repair and load');
		const recordedFailure = () =>
			vi
				.mocked(ipc.e2eRecord)
				.mock.calls.some(([e]) => JSON.parse(e).opened === false && JSON.parse(e).cliSchema);
		await vi.waitFor(() => expect(recordedFailure()).toBe(true));
		await fireEvent.click(fixButton);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		expect(ipc.readSchemaFile).toHaveBeenCalledWith('/w/s.json');
		expect(schemaSessions.for('fix-tab').origin).toMatchObject({ from: 'cli' });
	});

	it('after "Repair and load", a --wait --diff launch compares and reports the file opened', async () => {
		const handoff = new Handoff({
			path: '/w/old.json',
			piped: false,
			schema: null,
			compareWith: '/w/new.json',
			wait: '/tmp/pandia-wait-repair',
			reply: null,
		});
		docSchemas({});
		vi.mocked(ipc.cliWaitDone).mockClear();
		vi.mocked(ipc.docOpen)
			.mockResolvedValueOnce({
				kind: 'failed',
				detail: 'trailing comma',
				tooLargeToFix: false,
				diagnosis: {
					title: 'trailing comma',
					detail: 'Remove the comma.',
					excerpt: null,
					fix: { label: 'Repair and load', text: '{"a":1}', warnings: [] },
				},
			})
			.mockResolvedValueOnce(opened('O', { sourcePath: 'old.json', fileBacked: false }))
			.mockResolvedValueOnce(opened('N', { sourcePath: '/w/new.json', fileBacked: true }));
		const { container } = render(DocPane, {
			props: {
				tabId: 'repair-wait-tab',
				slot: slotWith(handoff),
				isActive: false,
				pendingOpen: { kind: 'file', path: '/w/old.json' },
			},
		});
		const fixButton = await within(container).findByText('Repair and load');
		await vi.waitFor(() =>
			expect(
				vi.mocked(ipc.e2eRecord).mock.calls.some(([e]) => JSON.parse(e).source === '/w/old.json'),
			).toBe(true),
		);
		await fireEvent.click(fixButton);
		await vi.waitFor(() => expect(container.querySelector('.view-modes')).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		const compared = vi
			.mocked(ipc.docOpen)
			.mock.calls.some(([s]) => s.kind === 'file' && s.path === '/w/new.json');
		await handoff.settle('repair-wait-tab');
		const report = vi.mocked(ipc.cliWaitDone).mock.calls[0]?.[1];
		expect({ compared, opened: report?.opened, problem: report?.problem }).toEqual({
			compared: true,
			opened: true,
			problem: null,
		});
	});
});
