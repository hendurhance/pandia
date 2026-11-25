import { describe, it, expect } from 'vitest';
import { urlFetchCommand } from './url-fetch';

describe('urlFetchCommand', () => {
	it('quotes the URL and each header so the cURL parser reads them back unchanged', () => {
		expect(
			urlFetchCommand(
				"https://x.dev/a?b=1&c=it's",
				"Authorization: Bearer a'b\nX-Empty:\nno colon",
			),
		).toBe(
			`curl -L 'https://x.dev/a?b=1&c=it'\\''s' -H 'Authorization: Bearer a'\\''b' -H 'X-Empty: '`,
		);
	});

	it('sends a bare GET that follows redirects when there are no headers', () => {
		expect(urlFetchCommand('https://api.x.dev/users', '')).toBe(
			"curl -L 'https://api.x.dev/users'",
		);
	});
});
