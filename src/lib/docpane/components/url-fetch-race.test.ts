// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SMALL_TIER } from '$lib/ipc/fake';
import { fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { TabSlot } from '$lib/shell/state/workspace.svelte';
import DocPane from './DocPane.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docOpen: vi.fn(),
		curlSend: vi.fn(),
		docClose: vi.fn(async () => {}),
		docBackupClear: vi.fn(async () => {}),
		docGetValue: vi.fn(async () => 'null'),
		docValidateSchema: vi.fn(),
		cancelJob: vi.fn(async () => true),
	}),
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

const slot = {
	register: () => () => {},
	handoff: null,
	isHandleAlive: () => true,
	versionOf: () => null,
} as unknown as TabSlot;

const summary = {
	rootKind: 'object' as const,
	rootChildCount: 0,
	sourcePath: 'pasted.json',
	sourceSize: 12,
	lazy: false,
	version: 1,
	dirty: false,
	fileBacked: false,
	recoveryNote: null,
	commentsStripped: false,
	...SMALL_TIER,
};

describe('fetch URL box', () => {
	it('does not replace a document the user opened while a URL fetch was still running', async () => {
		let answer!: (r: Awaited<ReturnType<typeof ipc.curlSend>>) => void;
		vi.mocked(ipc.curlSend).mockImplementation(() => new Promise((r) => (answer = r)));
		vi.mocked(ipc.docOpen).mockImplementation(async (source) => ({
			kind: 'opened',
			handle: (source.kind === 'text' && source.text.includes('pasted')
				? 'pasted'
				: 'fetched') as never,
			summary,
			notes: { convertedFrom: null, repairs: [] },
		}));

		const { container } = render(DocPane, { props: { tabId: 't1', slot, isActive: false } });

		const url = container.querySelector('input[placeholder^="https://"]') as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://slow.example/data.json' } });
		await fireEvent.keyDown(url, { key: 'Enter' });
		await vi.waitFor(() => expect(ipc.curlSend).toHaveBeenCalledOnce());

		const box = container.querySelector('textarea.paste') as HTMLTextAreaElement;
		await fireEvent.paste(box, { clipboardData: { getData: () => '{"pasted":true}' } });
		await vi.waitFor(() => expect(container.querySelector('textarea.paste')).toBeNull());
		expect(ipc.docOpen).toHaveBeenCalledTimes(1);

		answer({
			outcome: {
				kind: 'opened',
				handle: 'fetched' as never,
				summary,
				notes: { convertedFrom: null, repairs: [] },
			},
			response: {
				method: 'GET',
				url: 'https://slow.example/data.json',
				status: 200,
				statusText: 'OK',
			},
		});
		await new Promise((r) => setTimeout(r, 50));

		const opened = vi.mocked(ipc.docOpen).mock.calls.map(([source]) => source);
		expect(opened).toEqual([{ kind: 'text', text: '{"pasted":true}', name: 'pasted.json' }]);
		expect(ipc.docClose).not.toHaveBeenCalledWith('pasted');
		expect(ipc.docClose).toHaveBeenCalledWith('fetched');
	});
});
