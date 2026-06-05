import { describe, expect, it } from 'vitest';
import { detectFormat } from './detect-format';

describe('detectFormat', () => {
	it('returns unknown for empty / whitespace input', () => {
		expect(detectFormat('')).toBe('unknown');
		expect(detectFormat('   \n\t  ')).toBe('unknown');
	});

	it('detects JSON from its leading brace/bracket', () => {
		expect(detectFormat('{"a": 1}')).toBe('json');
		expect(detectFormat('  [1,2,3]')).toBe('json');
		expect(detectFormat('\n\n{\n  "x": 2\n}')).toBe('json');
	});

	it('detects XML', () => {
		expect(detectFormat('<?xml version="1.0"?>')).toBe('xml');
		expect(detectFormat('<root><a/></root>')).toBe('xml');
	});

	it('detects YAML via document marker or key:value head', () => {
		expect(detectFormat('---\nfoo: 1\n')).toBe('yaml');
		expect(detectFormat('name: pandia\nversion: 1\n')).toBe('yaml');
	});

	it('detects CSV from a multi-comma header + matching row', () => {
		expect(detectFormat('id,name,age\n1,a,30\n2,b,31')).toBe('csv');
	});

	it('detects cURL command paste', () => {
		expect(detectFormat('curl https://api.example.com/x')).toBe('curl');
		expect(detectFormat('CURL -X POST ...')).toBe('curl');
	});

	it('detects bare URL', () => {
		expect(detectFormat('https://example.com/data.json')).toBe('url');
		expect(detectFormat('  http://x.test/foo  ')).toBe('url');
	});

	it('treats a URL inside whitespace-y text as not-just-a-URL', () => {
		expect(detectFormat('see https://x.example.com for details')).toBe('unknown');
	});

	it('returns unknown for ambiguous plaintext', () => {
		expect(detectFormat('hello world')).toBe('unknown');
	});

	it('a YAML head with non-key lines downstream still classifies', () => {
		expect(detectFormat('foo: 1\nbar: 2')).toBe('yaml');
	});
});
