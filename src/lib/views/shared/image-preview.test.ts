// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { IpcError } from '$lib/ipc/error';
import type { RequestProblem } from '$lib/ipc/bindings';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { imagePreview } from './image-preview.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({ fetchImage: vi.fn() }),
}));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	behaviorPrefs: { init: async () => {}, loadWebImages: false, setLoadWebImages: vi.fn() },
}));

const el = {
	getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 40 }),
} as unknown as Element;

const IMAGE = { dataUrl: 'data:image/png;base64,AQID', bytes: 3, mediaType: 'image/png' };

function refused(request: RequestProblem) {
	return new IpcError('request', 'refused', { request });
}

async function hover(value: string) {
	imagePreview.hoverStart(el, async () => value);
	await vi.advanceTimersByTimeAsync(400);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	behaviorPrefs.loadWebImages = false;
	imagePreview.hide();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('imagePreview', () => {
	it('shows an embedded image straight away without any network request', async () => {
		await hover('data:image/png;base64,AAAA');
		expect(imagePreview.state).toMatchObject({ phase: 'ready', image: { type: 'image/png' } });
		expect(ipc.fetchImage).not.toHaveBeenCalled();
	});

	it('asks before loading a web image, loads on request, then reuses it', async () => {
		await hover('https://cdn.x.dev/a.png');
		expect(imagePreview.state).toMatchObject({ phase: 'ask', host: 'cdn.x.dev' });
		expect(ipc.fetchImage).not.toHaveBeenCalled();

		vi.mocked(ipc.fetchImage).mockResolvedValue(IMAGE);
		imagePreview.load();
		await vi.advanceTimersByTimeAsync(0);
		expect(imagePreview.state).toMatchObject({
			phase: 'ready',
			image: { src: 'data:image/png;base64,AQID', bytes: 3, type: 'image/png' },
		});

		imagePreview.hide();
		await hover('https://cdn.x.dev/a.png');
		expect(imagePreview.state.phase).toBe('ready');
		expect(ipc.fetchImage).toHaveBeenCalledTimes(1);
	});

	it('never opens the card for a quick pass over a value', async () => {
		imagePreview.hoverStart(el, async () => 'data:image/png;base64,AAAA');
		imagePreview.hoverEnd();
		await vi.advanceTimersByTimeAsync(600);
		expect(imagePreview.state.phase).toBe('hidden');
	});

	it('explains plainly when a link is not an image or the server refuses', async () => {
		behaviorPrefs.loadWebImages = true;
		vi.mocked(ipc.fetchImage).mockRejectedValue(
			refused({ problem: 'notData', contentType: 'text/html', status: 200 }),
		);
		await hover('https://x.dev/page.png');
		expect(imagePreview.state).toMatchObject({
			phase: 'error',
			message: "This link doesn't point to an image.",
		});

		vi.mocked(ipc.fetchImage).mockRejectedValue(
			refused({ problem: 'status', host: 'x.dev', status: 404 }),
		);
		await hover('https://x.dev/missing.png');
		expect(imagePreview.state).toMatchObject({ phase: 'error', message: 'x.dev answered 404.' });

		vi.mocked(ipc.fetchImage).mockRejectedValue(refused({ problem: 'tooLarge', limit: 10485760 }));
		await hover('https://x.dev/huge.png');
		expect(imagePreview.state).toMatchObject({
			phase: 'error',
			message: 'This image is over 10.0 MiB. Open the link to view it.',
		});

		vi.mocked(ipc.fetchImage).mockRejectedValue(refused({ problem: 'unreachable', host: 'x.dev' }));
		await hover('https://x.dev/gone.png');
		expect(imagePreview.state).toMatchObject({ phase: 'error', message: "Couldn't reach x.dev." });
	});
});
