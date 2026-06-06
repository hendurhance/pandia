export type DetectedFormat = 'json' | 'yaml' | 'xml' | 'csv' | 'curl' | 'url' | 'unknown';

export function detectFormat(text: string): DetectedFormat {
	const t = text.trim();
	if (!t) return 'unknown';

	if (t.length < 2048 && !/\s/.test(t) && /^https?:\/\//i.test(t)) return 'url';

	if (/^curl\s/i.test(t)) return 'curl';

	const first = t[0];

	if (first === '{' || first === '[') return 'json';

	if (first === '<') return 'xml';

	if (/^---\s*\n/.test(t)) return 'yaml';
	const head = t.split('\n', 12);
	const nonEmptyHead = head.filter((l) => l.trim().length > 0);
	if (
		nonEmptyHead.length > 0 &&
		nonEmptyHead.every((l) => /^[\w$.-]+\s*:\s*(\S.*)?$/.test(l.trim()))
	) {
		return 'yaml';
	}

	if (nonEmptyHead.length >= 2) {
		const commas0 = (nonEmptyHead[0].match(/,/g) ?? []).length;
		const commas1 = (nonEmptyHead[1].match(/,/g) ?? []).length;
		if (commas0 >= 2 && commas1 >= 1) return 'csv';
	}

	return 'unknown';
}

export function formatLabel(f: DetectedFormat): string {
	switch (f) {
		case 'json':
			return 'JSON';
		case 'yaml':
			return 'YAML';
		case 'xml':
			return 'XML';
		case 'csv':
			return 'CSV';
		case 'curl':
			return 'cURL';
		case 'url':
			return 'URL';
		default:
			return '';
	}
}
