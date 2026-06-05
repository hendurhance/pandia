export type TokenKind = 'string' | 'number' | 'keyword' | 'key' | 'punct' | 'text';

export interface Token {
	kind: TokenKind;
	text: string;
}

export function tokenizeJsonLine(line: string): Token[] {
	const tokens: Token[] = [];
	const n = line.length;
	let i = 0;
	let textStart = 0;

	const flushText = (end: number) => {
		if (end > textStart) tokens.push({ kind: 'text', text: line.slice(textStart, end) });
	};

	while (i < n) {
		const c = line[i];
		if (c === '"') {
			flushText(i);
			let j = i + 1;
			while (j < n) {
				if (line[j] === '\\' && j + 1 < n) {
					j += 2;
					continue;
				}
				if (line[j] === '"') {
					j++;
					break;
				}
				j++;
			}
			let k = j;
			while (k < n && (line[k] === ' ' || line[k] === '\t')) k++;
			const isKey = line[k] === ':';
			tokens.push({ kind: isKey ? 'key' : 'string', text: line.slice(i, j) });
			i = j;
			textStart = i;
			continue;
		}
		if (
			(c >= '0' && c <= '9') ||
			(c === '-' && i + 1 < n && line[i + 1] >= '0' && line[i + 1] <= '9')
		) {
			const m = line.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
			if (m) {
				flushText(i);
				tokens.push({ kind: 'number', text: m[0] });
				i += m[0].length;
				textStart = i;
				continue;
			}
		}
		if (c === 't' && line.startsWith('true', i)) {
			flushText(i);
			tokens.push({ kind: 'keyword', text: 'true' });
			i += 4;
			textStart = i;
			continue;
		}
		if (c === 'f' && line.startsWith('false', i)) {
			flushText(i);
			tokens.push({ kind: 'keyword', text: 'false' });
			i += 5;
			textStart = i;
			continue;
		}
		if (c === 'n' && line.startsWith('null', i)) {
			flushText(i);
			tokens.push({ kind: 'keyword', text: 'null' });
			i += 4;
			textStart = i;
			continue;
		}
		if (c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':') {
			flushText(i);
			tokens.push({ kind: 'punct', text: c });
			i++;
			textStart = i;
			continue;
		}
		i++;
	}
	flushText(n);
	return tokens;
}
