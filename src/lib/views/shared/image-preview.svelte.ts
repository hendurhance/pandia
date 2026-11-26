import { ipc } from '$lib/ipc/client';
import { IpcError } from '$lib/ipc/error';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { fmtBytes } from '$lib/util/format';
import { imageSource } from './image-source';

const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 150;
const CACHE_SIZE = 30;

export interface Anchor {
	left: number;
	top: number;
	bottom: number;
}

export interface LoadedImage {
	src: string;
	bytes: number;
	type: string;
}

export type PreviewState =
	| { phase: 'hidden' }
	| { phase: 'ask'; anchor: Anchor; host: string }
	| { phase: 'loading'; anchor: Anchor }
	| { phase: 'ready'; anchor: Anchor; image: LoadedImage }
	| { phase: 'error'; anchor: Anchor; message: string };

interface WebImage {
	url: string;
	host: string;
}

class ImagePreview {
	state: PreviewState = $state({ phase: 'hidden' });

	private request = 0;
	private openTimer: ReturnType<typeof setTimeout> | undefined;
	private closeTimer: ReturnType<typeof setTimeout> | undefined;
	private asking: { anchor: Anchor; image: WebImage } | null = null;
	private cache = new Map<string, LoadedImage>();

	hoverStart = (el: Element, read: () => Promise<string | null>) => {
		clearTimeout(this.closeTimer);
		clearTimeout(this.openTimer);
		const { left, top, bottom } = el.getBoundingClientRect();
		const id = ++this.request;
		this.openTimer = setTimeout(
			() => void this.open(id, { left, top, bottom }, read),
			OPEN_DELAY_MS,
		);
	};

	hoverEnd = () => {
		clearTimeout(this.openTimer);
		this.closeTimer = setTimeout(this.hide, CLOSE_DELAY_MS);
	};

	keepOpen = () => clearTimeout(this.closeTimer);

	hide = () => {
		clearTimeout(this.openTimer);
		clearTimeout(this.closeTimer);
		this.request++;
		this.asking = null;
		window.removeEventListener('scroll', this.hide, true);
		this.state = { phase: 'hidden' };
	};

	load = () => {
		if (!this.asking) return;
		const { anchor, image } = this.asking;
		this.asking = null;
		void this.download(this.request, anchor, image);
	};

	alwaysLoad = () => {
		void behaviorPrefs.setLoadWebImages(true);
		this.load();
	};

	private show(state: Exclude<PreviewState, { phase: 'hidden' }>) {
		if (this.state.phase === 'hidden') window.addEventListener('scroll', this.hide, true);
		this.state = state;
	}

	private async open(id: number, anchor: Anchor, read: () => Promise<string | null>) {
		const value = await read();
		if (id !== this.request || value === null) return;
		const source = imageSource(value);
		if (!source) return;
		if (source.kind === 'embedded') {
			const bytes = Math.floor(((source.uri.length - source.uri.indexOf(',') - 1) * 3) / 4);
			return this.show({
				phase: 'ready',
				anchor,
				image: { src: source.uri, bytes, type: source.type },
			});
		}
		const cached = this.cache.get(source.url);
		if (cached) return this.show({ phase: 'ready', anchor, image: cached });
		await behaviorPrefs.init();
		if (id !== this.request) return;
		if (!behaviorPrefs.loadWebImages) {
			this.asking = { anchor, image: source };
			return this.show({ phase: 'ask', anchor, host: source.host });
		}
		await this.download(id, anchor, source);
	}

	private async download(id: number, anchor: Anchor, image: WebImage) {
		this.show({ phase: 'loading', anchor });
		try {
			const loaded = await fetchImage(image);
			this.remember(image.url, loaded);
			if (id === this.request) this.show({ phase: 'ready', anchor, image: loaded });
		} catch (e) {
			const message =
				e instanceof Error && e.name !== 'AbortError'
					? e.message
					: `Couldn't load the image from ${image.host}.`;
			if (id === this.request) this.show({ phase: 'error', anchor, message });
		}
	}

	private remember(url: string, image: LoadedImage) {
		this.cache.set(url, image);
		if (this.cache.size <= CACHE_SIZE) return;
		this.cache.delete(this.cache.keys().next().value!);
	}
}

async function fetchImage({ url, host }: WebImage): Promise<LoadedImage> {
	try {
		const image = await ipc.fetchImage(url);
		return { src: image.dataUrl, bytes: image.bytes, type: image.mediaType };
	} catch (e) {
		throw new Error(imageFailure(e, host));
	}
}

function imageFailure(e: unknown, host: string): string {
	const problem = e instanceof IpcError ? e.request : undefined;
	switch (problem?.problem) {
		case 'notData':
			return "This link doesn't point to an image.";
		case 'tooLarge':
			return `This image is over ${fmtBytes(problem.limit)}. Open the link to view it.`;
		case 'status':
			return `${host} answered ${problem.status}.`;
		default:
			return `Couldn't reach ${host}.`;
	}
}

export const imagePreview = new ImagePreview();
