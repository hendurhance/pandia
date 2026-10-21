import { describe, expect, it } from 'vitest';
import { planSchema } from './schema-ref';

const docPath = '/work/configs/app.json';

describe('planSchema', () => {
	it('loads nothing when neither source names a schema', () => {
		expect(planSchema({ cliRef: null, docRef: null, docPath })).toEqual({ kind: 'none' });
	});

	it('resolves a relative document $schema against the document folder', () => {
		expect(planSchema({ cliRef: null, docRef: './app.schema.json', docPath })).toEqual({
			kind: 'load',
			from: 'document',
			ref: './app.schema.json',
			target: { kind: 'file', path: '/work/configs/./app.schema.json' },
			ignoredDocRef: null,
		});
	});

	it('prefers --schema and reports the document reference it overrode', () => {
		const plan = planSchema({ cliRef: '/work/s.json', docRef: './other.json', docPath });
		expect(plan).toMatchObject({
			kind: 'load',
			from: 'cli',
			target: { kind: 'file', path: '/work/s.json' },
			ignoredDocRef: './other.json',
		});
	});

	it('marks http as insecure and https as secure', () => {
		expect(planSchema({ cliRef: null, docRef: 'https://x.dev/s.json', docPath })).toMatchObject({
			target: { kind: 'url', url: 'https://x.dev/s.json', host: 'x.dev', secure: true },
		});
		expect(planSchema({ cliRef: null, docRef: 'http://x.dev/s.json', docPath })).toMatchObject({
			target: { kind: 'url', secure: false },
		});
	});

	it('turns a file:// URL into a path', () => {
		expect(
			planSchema({ cliRef: null, docRef: 'file:///work/my%20schema.json', docPath }),
		).toMatchObject({ target: { kind: 'file', path: '/work/my schema.json' } });
	});

	it('treats a JSON Schema dialect URI as the file being a schema, not an association', () => {
		const dialect = 'https://json-schema.org/draft/2020-12/schema';
		expect(planSchema({ cliRef: null, docRef: dialect, docPath })).toEqual({ kind: 'none' });
		expect(planSchema({ cliRef: '/s.json', docRef: dialect, docPath })).toMatchObject({
			from: 'cli',
			ignoredDocRef: null,
		});
	});

	it('refuses a relative path in a document that is not saved in a folder', () => {
		expect(planSchema({ cliRef: null, docRef: './s.json', docPath: null })).toMatchObject({
			kind: 'invalid',
			from: 'document',
		});
	});

	it('refuses schemes other than files and http(s)', () => {
		expect(planSchema({ cliRef: null, docRef: 'urn:example:schema', docPath })).toMatchObject({
			kind: 'invalid',
		});
	});
});
