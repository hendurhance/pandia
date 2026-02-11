import { render, type RenderResult } from '@testing-library/svelte';
import type { Component } from 'svelte';

// Custom render function with common providers
export function renderComponent<T extends Component<Record<string, unknown>>>(
	component: T,
	options?: { props?: Record<string, unknown> }
): RenderResult<T> {
	return render(component, options) as RenderResult<T>;
}

// Test data generators
export function generateLargeJSON(sizeInMB: number): string {
	const targetSize = sizeInMB * 1024 * 1024;
	const items: Record<string, unknown>[] = [];

	while (JSON.stringify(items).length < targetSize) {
		items.push({
			id: crypto.randomUUID(),
			name: `Item ${items.length}`,
			description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
			timestamp: Date.now(),
			data: {
				nested: {
					value: Math.random(),
					array: [1, 2, 3, 4, 5]
				}
			}
		});
	}

	return JSON.stringify({ items }, null, 2);
}

// Generate nested JSON structure
function generateNestedJSON(depth: number): string {
	let json = '{"value": 1}';
	for (let i = 0; i < depth; i++) {
		json = `{"level${i}": ${json}}`;
	}
	return json;
}

// Sample JSON for tests
export const sampleJSON = {
	valid: '{"name": "test", "value": 42}',
	invalid: '{"name": "test", "value": }',
	nested: '{"a": {"b": {"c": 1}}}',
	array: '[1, 2, 3, 4, 5]',
	empty: '{}',
	emptyArray: '[]',
	largeNesting: generateNestedJSON(50),
	withSpecialChars: '{"message": "Hello\\nWorld\\t!"}',
	unicode: '{"emoji": "\\u2764\\uFE0F", "japanese": "\\u3053\\u3093\\u306B\\u3061\\u306F"}',
	withNumbers: '{"int": 42, "float": 3.14, "negative": -100, "scientific": 1.5e10}',
	withBooleans: '{"active": true, "deleted": false}',
	withNull: '{"value": null}',
	complex: JSON.stringify({
		users: [
			{ id: 1, name: 'John', email: 'john@example.com' },
			{ id: 2, name: 'Jane', email: 'jane@example.com' }
		],
		metadata: {
			total: 2,
			page: 1,
			hasMore: false
		}
	})
};

// YAML sample for import tests
export const sampleYAML = `name: test
value: 42
nested:
  key: value
items:
  - one
  - two
  - three
`;

// XML sample for import tests
export const sampleXML = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <name>test</name>
  <value>42</value>
  <items>
    <item>one</item>
    <item>two</item>
  </items>
</root>`;

// CSV sample for import tests
export const sampleCSV = `name,value,category
item1,100,A
item2,200,B
item3,300,A`;

// Wait utilities
export function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
	condition: () => boolean,
	timeout = 5000,
	interval = 100
): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeout) {
			throw new Error('Condition not met within timeout');
		}
		await waitFor(interval);
	}
}

// Performance measurement utilities
export function measureTime<T>(fn: () => T): { result: T; duration: number } {
	const start = performance.now();
	const result = fn();
	const duration = performance.now() - start;
	return { result, duration };
}

export async function measureTimeAsync<T>(
	fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
	const start = performance.now();
	const result = await fn();
	const duration = performance.now() - start;
	return { result, duration };
}

// File path utilities for tests
export const testPaths = {
	validJson: '/test/valid.json',
	invalidJson: '/test/invalid.json',
	largeJson: '/test/large.json',
	yaml: '/test/data.yaml',
	xml: '/test/data.xml',
	csv: '/test/data.csv',
	restricted: '/etc/passwd',
	ssh: '/Users/test/.ssh/id_rsa',
	windowsSystem: 'C:\\Windows\\System32\\config'
};

// Create a mock file with content
export function createMockJSON(data: unknown): string {
	return JSON.stringify(data, null, 2);
}

// Assert JSON equality (ignoring formatting)
export function assertJSONEqual(actual: string, expected: string): boolean {
	try {
		const parsedActual = JSON.parse(actual);
		const parsedExpected = JSON.parse(expected);
		return JSON.stringify(parsedActual) === JSON.stringify(parsedExpected);
	} catch {
		return false;
	}
}

// Generate array of items for testing
export function generateItems(count: number): Array<{ id: number; name: string; value: number }> {
	return Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		name: `Item ${i + 1}`,
		value: Math.floor(Math.random() * 1000)
	}));
}

// Deep clone utility
export function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}
