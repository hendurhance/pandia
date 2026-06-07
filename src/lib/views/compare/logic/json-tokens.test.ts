import { describe, it, expect } from 'vitest';
import { tokenizeJsonLine } from './json-tokens';

const dump = (line: string): string =>
	tokenizeJsonLine(line)
		.map((t) => `${t.kind}:${t.text}`)
		.join('|');

describe('tokenizeJsonLine', () => {
	it('distinguishes a key string from a value string (key is followed by `:`)', () => {
		expect(dump('  "name": "Ada",')).toBe('text:  |key:"name"|punct::|text: |string:"Ada"|punct:,');
	});

	it('handles escaped quotes inside strings', () => {
		expect(dump('"with \\"escape\\""')).toBe('string:"with \\"escape\\""');
	});

	it('tokenizes numbers, including negatives + decimals + exponent', () => {
		expect(dump('42')).toBe('number:42');
		expect(dump('-3.14')).toBe('number:-3.14');
		expect(dump('1.5e10')).toBe('number:1.5e10');
		expect(dump('"k": -7,')).toBe('key:"k"|punct::|text: |number:-7|punct:,');
	});

	it('classifies true / false / null as keywords', () => {
		expect(dump('true,')).toBe('keyword:true|punct:,');
		expect(dump('  false')).toBe('text:  |keyword:false');
		expect(dump('null')).toBe('keyword:null');
	});

	it('emits brackets and braces as punctuation', () => {
		expect(dump('{ "a": [1, 2] }')).toBe(
			'punct:{|text: |key:"a"|punct::|text: |punct:[|number:1|punct:,|text: |number:2|punct:]|text: |punct:}',
		);
	});
});
