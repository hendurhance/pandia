export function parseHeaders(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const i = line.indexOf(':');
		if (i < 0) continue;
		const k = line.slice(0, i).trim();
		if (k) out[k] = line.slice(i + 1).trim();
	}
	return out;
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function urlFetchCommand(url: string, headersText: string): string {
	const headers = Object.entries(parseHeaders(headersText)).map(
		([name, value]) => ` -H ${quote(`${name}: ${value}`)}`,
	);
	return `curl -L ${quote(url)}${headers.join('')}`;
}
