import { dirname } from '$lib/util/path';

export type SchemaFrom = 'cli' | 'document';

export type SchemaTarget =
	| { kind: 'file'; path: string }
	| { kind: 'url'; url: string; host: string; secure: boolean };

export type SchemaPlan =
	| { kind: 'none' }
	| {
			kind: 'load';
			from: SchemaFrom;
			ref: string;
			target: SchemaTarget;
			ignoredDocRef: string | null;
	  }
	| { kind: 'invalid'; from: SchemaFrom; ref: string; message: string };

const WINDOWS_ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\)/;
const ANY_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// In a schema file, $schema names the JSON Schema dialect rather than a schema to validate against.
function isDialect(ref: string): boolean {
	return /^https?:\/\/json-schema\.org\//i.test(ref);
}

function resolve(ref: string, baseDir: string | null): SchemaTarget | string {
	if (/^https?:\/\//i.test(ref)) {
		try {
			const url = new URL(ref);
			return { kind: 'url', url: ref, host: url.host, secure: url.protocol === 'https:' };
		} catch {
			return `"${ref}" isn't a valid URL.`;
		}
	}
	if (/^file:\/\//i.test(ref)) {
		const path = decodeURIComponent(new URL(ref).pathname);
		return { kind: 'file', path: /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path };
	}
	if (ANY_SCHEME.test(ref) && !WINDOWS_ABSOLUTE.test(ref)) {
		return `Pandia loads schemas from a file path or an https:// URL, not "${ref}".`;
	}
	if (ref.startsWith('/') || WINDOWS_ABSOLUTE.test(ref)) return { kind: 'file', path: ref };
	if (baseDir === null) {
		return `"${ref}" is a relative path, but this document isn't saved in a folder, so Pandia can't find it.`;
	}
	return { kind: 'file', path: baseDir ? `${baseDir}/${ref}` : ref };
}

export function planSchema(input: {
	cliRef: string | null;
	docRef: string | null;
	docPath: string | null;
}): SchemaPlan {
	const docRef = input.docRef && !isDialect(input.docRef) ? input.docRef : null;
	const from: SchemaFrom = input.cliRef ? 'cli' : 'document';
	const ref = input.cliRef ?? docRef;
	if (!ref) return { kind: 'none' };
	const baseDir = from === 'document' && input.docPath ? dirname(input.docPath) : null;
	const target = resolve(ref, baseDir);
	if (typeof target === 'string') return { kind: 'invalid', from, ref, message: target };
	const ignoredDocRef = from === 'cli' && docRef && docRef !== ref ? docRef : null;
	return { kind: 'load', from, ref, target, ignoredDocRef };
}
