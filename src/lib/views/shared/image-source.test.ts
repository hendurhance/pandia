import { describe, expect, it } from 'vitest';
import { imageSource, mayBeImage } from './image-source';

describe('imageSource', () => {
	it('recognises embedded base64 images', () => {
		const uri = 'data:image/png;base64,iVBORw0KGgo=';
		expect(imageSource(uri)).toEqual({ kind: 'embedded', uri, type: 'image/png' });
		expect(imageSource('data:image/svg+xml;base64,PHN2Zz4=')).toMatchObject({
			type: 'image/svg+xml',
		});
	});

	it('recognises https links whose path ends in an image extension', () => {
		expect(imageSource('https://cdn.x.dev/a/photo.JPG?w=200')).toEqual({
			kind: 'web',
			url: 'https://cdn.x.dev/a/photo.JPG?w=200',
			host: 'cdn.x.dev',
		});
	});

	it('ignores http links, non-image links and plain text', () => {
		expect(imageSource('http://x.dev/a.png')).toBeNull();
		expect(imageSource('https://x.dev/page.html')).toBeNull();
		expect(imageSource('data:text/plain;base64,aGk=')).toBeNull();
		expect(imageSource('photo.png')).toBeNull();
	});
});

describe('mayBeImage', () => {
	it('decides from the start of a value, so a cut-off preview still counts', () => {
		expect(mayBeImage('data:image/png;base64,iVBOR')).toBe(true);
		expect(mayBeImage('https://x.dev/a.webp')).toBe(true);
		expect(mayBeImage('hello"')).toBe(false);
	});
});
