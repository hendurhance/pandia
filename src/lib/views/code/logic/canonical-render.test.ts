import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringifyWithOffsets } from './highlights';

interface Case {
	name: string;
	input: string;
	expected: string;
}

const cases: Case[] = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL('../../../../../src-tauri/src/doc/canonical_cases.json', import.meta.url),
		),
		'utf8',
	),
);

describe('canonical rendering matches the shared goldens', () => {
	it('has a real fixture set', () => {
		expect(cases.length).toBeGreaterThanOrEqual(30);
	});

	for (const c of cases) {
		it(c.name, () => {
			expect(stringifyWithOffsets(JSON.parse(c.input)).text).toBe(c.expected);
		});
	}
});
