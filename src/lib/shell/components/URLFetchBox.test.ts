// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { fetch } from '@tauri-apps/plugin-http';
import URLFetchBox from './URLFetchBox.svelte';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

describe('URLFetchBox', () => {
	it('says which host it could not reach, not the network library text', async () => {
		vi.mocked(fetch).mockRejectedValue(
			'error sending request for url (https://nope.invalid/x.json): dns error: failed to lookup address information',
		);
		const { container, findByText } = render(URLFetchBox, {
			props: { busy: false, onLoad: () => {} },
		});
		const input = container.querySelector('input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'https://nope.invalid/x.json' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		const err = await findByText(/nope\.invalid/);
		expect(err.textContent).toBe("Couldn't reach nope.invalid. Check the URL and your connection.");
	});

	it('says "cancelled" when the user cancels, not the plugin text', async () => {
		// The HTTP plugin rejects a cancelled request with a plain string, not an AbortError.
		vi.mocked(fetch).mockImplementation(
			(_url, init) =>
				new Promise((_, reject) =>
					init?.signal?.addEventListener('abort', () => reject('Request canceled')),
				),
		);
		const { container, getByText, findByText } = render(URLFetchBox, {
			props: { busy: false, onLoad: () => {} },
		});
		const input = container.querySelector('input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'https://slow.example/x.json' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(getByText('Cancel'));

		expect(await findByText('cancelled')).toBeTruthy();
	});
});
