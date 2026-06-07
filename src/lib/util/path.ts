import type { Path, PathSegment } from '$lib/ipc/types';

export function pathToString(path: Path): string {
	if (path.length === 0) return '$';
	let s = '$';
	for (const seg of path as PathSegment[]) {
		if (typeof seg === 'number') {
			s += `[${seg}]`;
		} else if (isBareIdentifier(seg)) {
			s += `.${seg}`;
		} else {
			s += `[${JSON.stringify(seg)}]`;
		}
	}
	return s;
}

const BARE_IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
function isBareIdentifier(key: string): boolean {
	return BARE_IDENT_RE.test(key);
}

export function parsePath(input: string): { ok: true; path: Path } | { ok: false; error: string } {
	let s = input.trim();
	if (s === '' || s === '$') return { ok: true, path: [] };
	if (s.startsWith('$')) s = s.slice(1);

	const segs: PathSegment[] = [];
	let i = 0;
	const n = s.length;

	while (i < n) {
		const c = s[i];
		if (c === '.') {
			i++;
			let key = '';
			while (i < n && s[i] !== '.' && s[i] !== '[') {
				key += s[i++];
			}
			if (key === '') return { ok: false, error: `empty key after '.' at ${i}` };
			segs.push(key);
		} else if (c === '[') {
			i++;
			if (i >= n) return { ok: false, error: 'unterminated `[`' };
			const q = s[i];
			if (q === '"' || q === "'") {
				i++;
				let key = '';
				while (i < n && s[i] !== q) {
					if (s[i] === '\\' && i + 1 < n) {
						i++; // skip escape
						key += s[i++];
					} else {
						key += s[i++];
					}
				}
				if (i >= n) return { ok: false, error: 'unterminated quoted key' };
				i++; // closing quote
				if (s[i] !== ']') return { ok: false, error: `expected ']' at ${i}` };
				i++;
				segs.push(key);
			} else {
				let num = '';
				while (i < n && s[i] !== ']') num += s[i++];
				if (i >= n) return { ok: false, error: 'unterminated `[`' };
				i++; // ']'
				const trimmed = num.trim();
				if (!/^\d+$/.test(trimmed)) {
					return { ok: false, error: `expected array index, got "${trimmed}"` };
				}
				segs.push(Number(trimmed));
			}
		} else {
			let key = '';
			while (i < n && s[i] !== '.' && s[i] !== '[') key += s[i++];
			if (key === '') return { ok: false, error: `unexpected '${c}' at ${i}` };
			segs.push(key);
		}
	}
	return { ok: true, path: segs };
}

export function parseJsonPointer(ptr: string): Path {
	if (ptr === '' || ptr === '/') return ptr === '/' ? [''] : [];
	return ptr
		.split('/')
		.slice(1)
		.map((tok): PathSegment => {
			const k = tok.replace(/~1/g, '/').replace(/~0/g, '~');
			return /^(0|[1-9][0-9]*)$/.test(k) ? Number(k) : k;
		});
}

export function resolveJsonPointer(
	ptr: string,
	kindOfParent: (prefix: Path) => 'object' | 'array' | null,
): Path {
	if (ptr === '' || ptr === '/') return ptr === '/' ? [''] : [];
	const tokens = ptr
		.split('/')
		.slice(1)
		.map((tok) => tok.replace(/~1/g, '/').replace(/~0/g, '~'));
	const out: Path = [];
	for (const tok of tokens) {
		const parentKind = kindOfParent(out);
		const looksNumeric = /^(0|[1-9][0-9]*)$/.test(tok);
		if (parentKind === 'object') {
			out.push(tok); // object key — always a string even if all-digit
		} else if (looksNumeric) {
			out.push(Number(tok)); // array (or unknown) — numeric index
		} else {
			out.push(tok);
		}
	}
	return out;
}

export function basename(path: string): string {
	const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return slash >= 0 ? path.slice(slash + 1) : path;
}

export function stem(path: string): string {
	return basename(path).replace(/\.[^.]+$/, '');
}
