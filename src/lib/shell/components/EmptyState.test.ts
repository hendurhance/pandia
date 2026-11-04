// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import type { CurlPreview } from '$lib/ipc/bindings';
import EmptyState from './EmptyState.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: { curlPreview: vi.fn(), cancelJob: vi.fn(async () => true) },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

function preview(over: Partial<CurlPreview>): CurlPreview {
	return {
		method: 'GET',
		url: 'https://api.example.com/users/1',
		headerNames: [],
		bodyBytes: null,
		sendsOnPaste: true,
		refusal: null,
		...over,
	};
}

function setup() {
	const onOpenSource = vi.fn(async () => true);
	const onSendRequest = vi.fn(async () => true);
	const view = render(EmptyState, {
		props: {
			busy: false,
			onOpenSource,
			onSendRequest,
			onOpenFile: () => {},
			diagnosis: null,
			onFixDiagnosis: () => {},
			onDismissDiagnosis: () => {},
		},
	});
	const paste = (text: string) =>
		fireEvent.paste(view.container.querySelector('textarea')!, {
			clipboardData: { getData: () => text },
		});
	return { ...view, paste, onOpenSource, onSendRequest };
}

const POST = `curl -X POST https://api.example.com/users -H 'Authorization: Bearer secret' -d '{"name":"Ada"}'`;

afterEach(() => cleanup());

describe('EmptyState pasting a cURL command', () => {
	it('sends a GET as soon as it is pasted', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue(preview({}));
		const { paste, onSendRequest, onOpenSource } = setup();
		await paste('curl https://api.example.com/users/1');

		await vi.waitFor(() => expect(onSendRequest).toHaveBeenCalledOnce());
		expect(onSendRequest).toHaveBeenCalledWith(
			'curl https://api.example.com/users/1',
			expect.any(String),
		);
		expect(onOpenSource).not.toHaveBeenCalled();
	});

	it('shows a POST without sending it until the send button is clicked', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue(
			preview({
				method: 'POST',
				url: 'https://api.example.com/users',
				headerNames: ['Authorization', 'Content-Type'],
				bodyBytes: 14,
				sendsOnPaste: false,
			}),
		);
		const { paste, onSendRequest, findByRole, getByText, container } = setup();
		await paste(POST);

		const send = await findByRole('button', { name: 'Send POST request' });
		expect(getByText('https://api.example.com/users')).toBeTruthy();
		expect(getByText(/Authorization, Content-Type/)).toBeTruthy();
		expect(getByText(/14 B/)).toBeTruthy();
		expect(container.textContent).not.toContain('secret');
		expect(onSendRequest).not.toHaveBeenCalled();

		await fireEvent.click(send);
		expect(onSendRequest).toHaveBeenCalledWith(POST, expect.any(String));
	});

	it('still opens the request itself as JSON', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue(preview({ method: 'POST', sendsOnPaste: false }));
		const { paste, findByRole, onOpenSource, onSendRequest } = setup();
		await paste(POST);

		await fireEvent.click(await findByRole('button', { name: 'Open the request as JSON' }));
		expect(onOpenSource).toHaveBeenCalledWith({ kind: 'text', text: POST, name: 'pasted.json' });
		expect(onSendRequest).not.toHaveBeenCalled();
	});

	it('says why a refused command will not be sent, and offers no send button', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue(
			preview({ sendsOnPaste: false, refusal: { reason: 'insecure', option: '-k' } }),
		);
		const { paste, findByText, queryByRole, onSendRequest } = setup();
		await paste('curl -k https://api.example.com/users/1');

		expect(await findByText(/-k turns off certificate checks/)).toBeTruthy();
		expect(queryByRole('button', { name: /^Send/ })).toBeNull();
		expect(onSendRequest).not.toHaveBeenCalled();
	});

	it('shows that it is sending, and cancels the request by its job id', async () => {
		vi.mocked(ipc.curlPreview).mockResolvedValue(preview({}));
		const { paste, onSendRequest, findByRole, findByText } = setup();
		onSendRequest.mockImplementation(() => new Promise(() => {}));
		await paste('curl https://api.example.com/users/1');

		expect(await findByText(/Waiting for the response/)).toBeTruthy();
		await fireEvent.click(await findByRole('button', { name: 'Cancel' }));
		const jobId = (onSendRequest.mock.calls[0] as unknown as [string, string])[1];
		expect(ipc.cancelJob).toHaveBeenCalledWith(jobId);
	});

	it('names the address it is waiting on and counts the seconds', async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(ipc.curlPreview).mockResolvedValue(preview({}));
			const { paste, onSendRequest, getByText } = setup();
			onSendRequest.mockImplementation(() => new Promise(() => {}));
			await paste('curl https://api.example.com/users/1');
			await vi.advanceTimersByTimeAsync(0);

			const waiting = getByText(/Waiting for the response/);
			expect(waiting.closest('.request')?.textContent).toContain('https://api.example.com/users/1');
			expect(waiting.textContent).not.toMatch(/\d+s/);
			await vi.advanceTimersByTimeAsync(3000);
			expect(waiting.textContent).toContain('3s');
		} finally {
			vi.useRealTimers();
		}
	});
});
