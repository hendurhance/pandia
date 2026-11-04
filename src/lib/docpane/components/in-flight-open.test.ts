// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { OpenOutcome, SentRequest } from '$lib/ipc/bindings';
import { Workspace } from '$lib/shell/state/workspace.svelte';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		curlPreview: vi.fn(),
		curlSend: vi.fn(),
		cancelJob: vi.fn(async () => true),
		docOpen: vi.fn(),
		docClose: vi.fn(async () => true),
		docSummary: vi.fn(),
		docGetSlice: vi.fn(async () => []),
		docGetValue: vi.fn(async () => {
			throw new Error('no $schema');
		}),
		docColumnSchema: vi.fn(async () => ({ gridSuitable: false })),
		docBackupClear: vi.fn(async () => null),
		e2eRecord: vi.fn(async () => {}),
	},
}));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(async () => ({ size: 10 })) }));

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
Element.prototype.scrollTo = () => {};

function opened(handle: string, sourcePath: string, fileBacked: boolean): OpenOutcome {
	return {
		kind: 'opened',
		handle: handle as never,
		summary: {
			rootKind: 'object',
			rootChildCount: 0,
			sourcePath,
			sourceSize: 2,
			lazy: false,
			version: 0,
			dirty: false,
			fileBacked,
			recoveryNote: null,
			commentsStripped: false,
		},
		notes: { convertedFrom: null, repairs: [] },
	};
}

describe('a file arriving while a pasted cURL request waits for its response', () => {
	it('still opens the response', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue({
			method: 'GET',
			url: 'https://api.example.com/users',
			headerNames: [],
			bodyBytes: null,
			sendsOnPaste: true,
			refusal: null,
		});
		let answer!: (r: SentRequest) => void;
		vi.mocked(ipc.curlSend).mockImplementation(() => new Promise((r) => (answer = r)));
		vi.mocked(ipc.docOpen).mockResolvedValue(opened('dropped', '/w/dropped.json', true));

		const ws = new Workspace({
			confirmLargeFile: async () => true,
			confirmUnsaved: async () => 'cancel',
		});
		const { container, rerender } = render(DocPane, {
			props: {
				tabId: 'tab-1',
				slot: ws.slot('tab-1'),
				isActive: false,
				pendingOpen: null,
				onOpened: () => ws.clearPendingOpen('tab-1'),
			},
		});

		const box = container.querySelector('textarea.paste') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'curl https://api.example.com/users' } });
		await fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
		await vi.waitFor(() => expect(ipc.curlSend).toHaveBeenCalled());

		const outcome = await ws.open({ kind: 'file', path: '/w/dropped.json' });
		if (outcome.kind === 'opened' && outcome.tabId === 'tab-1') {
			await rerender({ pendingOpen: ws.pendingOpens['tab-1'] ?? null });
			await vi.waitFor(() => expect(ipc.docOpen).toHaveBeenCalled());
		}

		answer({
			outcome: opened('response', 'users.json', false),
			response: {
				method: 'GET',
				url: 'https://api.example.com/users',
				status: 200,
				statusText: 'OK',
			},
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(outcome).toMatchObject({ kind: 'opened' });
		expect(ipc.docClose, 'the response document was closed unseen').not.toHaveBeenCalledWith(
			'response',
		);
	});
});
