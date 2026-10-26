const EMBEDDED =
	/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon));base64,/i;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

export type ImageSource =
	| { kind: 'embedded'; uri: string; type: string }
	| { kind: 'web'; url: string; host: string };

export function imageSource(value: string): ImageSource | null {
	const embedded = EMBEDDED.exec(value);
	if (embedded?.[1]) return { kind: 'embedded', uri: value, type: embedded[1].toLowerCase() };
	if (!value.startsWith('https://')) return null;
	try {
		const url = new URL(value);
		return IMAGE_PATH.test(url.pathname) ? { kind: 'web', url: value, host: url.host } : null;
	} catch {
		return null;
	}
}

export function mayBeImage(start: string): boolean {
	return EMBEDDED.test(start) || imageSource(start) !== null;
}
