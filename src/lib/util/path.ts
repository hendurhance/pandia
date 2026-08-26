import type { Path, PathSegment } from '$lib/ipc/bindings';

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

const ELLIPSIS = '…';

export function truncatePathMiddle(path: string, budget: number): string {
	if (path.length <= budget) return path;
	const sep = path.includes('/') ? '/' : '\\';
	const segs = path.split(sep);
	const base = segs.pop() ?? '';

	if (ELLIPSIS.length + sep.length + base.length > budget) {
		return truncateBasename(base, budget);
	}

	let lo = 0;
	let hi = segs.length;
	let len = ELLIPSIS.length + sep.length + base.length;
	let front = true;
	while (lo < hi) {
		const seg = front ? segs[lo] : segs[hi - 1];
		if (seg === undefined) break;
		if (len + seg.length + sep.length > budget) break;
		len += seg.length + sep.length;
		if (front) lo++;
		else hi--;
		front = !front;
	}
	return [...segs.slice(0, lo), ELLIPSIS, ...segs.slice(hi), base].join(sep);
}

function truncateBasename(name: string, budget: number): string {
	if (name.length <= budget) return name;
	const dot = name.lastIndexOf('.');
	const ext = dot > 0 ? name.slice(dot) : '';
	const stem = ext ? name.slice(0, dot) : name;
	if (ext && budget - ext.length > ELLIPSIS.length) {
		return middleCut(stem, budget - ext.length) + ext;
	}
	return middleCut(stem.length >= budget ? stem : name, budget);
}

function middleCut(s: string, width: number): string {
	if (s.length <= width) return s;
	if (width <= ELLIPSIS.length) return width > 0 ? ELLIPSIS : '';
	const keep = width - ELLIPSIS.length;
	const tail = Math.ceil(keep / 2);
	return s.slice(0, keep - tail) + ELLIPSIS + s.slice(s.length - tail);
}

export function stem(path: string): string {
	return basename(path).replace(/\.[^.]+$/, '');
}
