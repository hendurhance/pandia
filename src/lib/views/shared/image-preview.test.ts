// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { imagePreview } from './image-preview.svelte';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('$lib/settings/state/behavior-prefs.svelte', () => ({
	behaviorPrefs: { init: async () => {}, loadWebImages: false, setLoadWebImages: vi.fn() },
}));

const el = {
	getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 40 }),
} as unknown as Element;

function reply(status = 200, type = 'image/png') {
	return new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': type } });
}

async function hover(value: string) {
	imagePreview.hoverStart(el, async () => value);
	await vi.advanceTimersByTimeAsync(400);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	URL.createObjectURL = vi.fn(() => 'blob:preview');
	URL.revokeObjectURL = vi.fn();
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
		expect(fetch).not.toHaveBeenCalled();
	});

	it('asks before loading a web image, loads on request, then reuses it', async () => {
		await hover('https://cdn.x.dev/a.png');
		expect(imagePreview.state).toMatchObject({ phase: 'ask', host: 'cdn.x.dev' });
		expect(fetch).not.toHaveBeenCalled();

		vi.mocked(fetch).mockResolvedValue(reply());
		imagePreview.load();
		await vi.advanceTimersByTimeAsync(0);
		expect(imagePreview.state).toMatchObject({
			phase: 'ready',
			image: { src: 'blob:preview', bytes: 3, type: 'image/png' },
		});

		imagePreview.hide();
		await hover('https://cdn.x.dev/a.png');
		expect(imagePreview.state.phase).toBe('ready');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('never opens the card for a quick pass over a value', async () => {
		imagePreview.hoverStart(el, async () => 'data:image/png;base64,AAAA');
		imagePreview.hoverEnd();
		await vi.advanceTimersByTimeAsync(600);
		expect(imagePreview.state.phase).toBe('hidden');
	});

	it('explains plainly when a link is not an image or the server refuses', async () => {
		behaviorPrefs.loadWebImages = true;
		vi.mocked(fetch).mockResolvedValue(reply(200, 'text/html'));
		await hover('https://x.dev/page.png');
		expect(imagePreview.state).toMatchObject({
			phase: 'error',
			message: "This link doesn't point to an image.",
		});

		vi.mocked(fetch).mockResolvedValue(reply(404));
		await hover('https://x.dev/missing.png');
		expect(imagePreview.state).toMatchObject({ phase: 'error', message: 'x.dev answered 404.' });
	});
});
