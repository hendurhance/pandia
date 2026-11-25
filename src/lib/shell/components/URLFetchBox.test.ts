// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import URLFetchBox from './URLFetchBox.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({ cancelJob: vi.fn(async () => true) }),
}));

async function fetchUrl(container: HTMLElement, url: string) {
	const input = container.querySelector('input') as HTMLInputElement;
	await fireEvent.input(input, { target: { value: url } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

describe('URLFetchBox', () => {
	it('sends the URL and headers as a cURL GET that follows redirects', async () => {
		const onSendRequest = vi.fn(async (_curl: string, _jobId: string) => true);
		const { container, getByText } = render(URLFetchBox, {
			props: { busy: false, onSendRequest },
		});
		await fireEvent.click(getByText('+ headers'));
		const headers = container.querySelector('textarea.headers') as HTMLTextAreaElement;
		await fireEvent.input(headers, { target: { value: 'Authorization: Bearer t0k' } });
		await fetchUrl(container, 'https://api.x.dev/users');

		expect(onSendRequest).toHaveBeenCalledWith(
			"curl -L 'https://api.x.dev/users' -H 'Authorization: Bearer t0k'",
			expect.any(String),
		);
		await vi.waitFor(() =>
			expect((container.querySelector('input') as HTMLInputElement).value).toBe(''),
		);
	});

	it('cancels the running request by its job id', async () => {
		const onSendRequest = vi.fn((_curl: string, _jobId: string) => new Promise<boolean>(() => {}));
		const { container, findByText } = render(URLFetchBox, {
			props: { busy: false, onSendRequest },
		});
		await fetchUrl(container, 'https://slow.example/x.json');
		await fireEvent.click(await findByText('Cancel'));

		const jobId = onSendRequest.mock.calls[0]![1];
		expect(ipc.cancelJob).toHaveBeenCalledWith(jobId);
	});
});
