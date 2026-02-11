import { bench, describe } from 'vitest';
import { generateLargeJSON } from '../setup/test-utils';

describe('JSON Parsing Benchmarks', () => {
	// Generate test data once
	const small = generateLargeJSON(0.1); // 100KB
	const medium = generateLargeJSON(1); // 1MB
	const large = generateLargeJSON(5); // 5MB

	describe('Native JSON Operations', () => {
		bench('Parse 100KB JSON', () => {
			JSON.parse(small);
		});

		bench('Parse 1MB JSON', () => {
			JSON.parse(medium);
		});

		bench('Parse 5MB JSON', () => {
			JSON.parse(large);
		});

		bench('Stringify 100KB JSON', () => {
			const parsed = JSON.parse(small);
			JSON.stringify(parsed);
		});

		bench('Stringify 1MB JSON', () => {
			const parsed = JSON.parse(medium);
			JSON.stringify(parsed);
		});

		bench('Stringify 5MB JSON', () => {
			const parsed = JSON.parse(large);
			JSON.stringify(parsed);
		});

		bench('Format 100KB JSON (2-space indent)', () => {
			const parsed = JSON.parse(small);
			JSON.stringify(parsed, null, 2);
		});

		bench('Format 1MB JSON (2-space indent)', () => {
			const parsed = JSON.parse(medium);
			JSON.stringify(parsed, null, 2);
		});

		bench('Format 5MB JSON (2-space indent)', () => {
			const parsed = JSON.parse(large);
			JSON.stringify(parsed, null, 2);
		});
	});

	describe('JSON Validation', () => {
		bench('Validate 100KB JSON', () => {
			try {
				JSON.parse(small);
			} catch {
				// Invalid
			}
		});

		bench('Validate 1MB JSON', () => {
			try {
				JSON.parse(medium);
			} catch {
				// Invalid
			}
		});

		bench('Validate 5MB JSON', () => {
			try {
				JSON.parse(large);
			} catch {
				// Invalid
			}
		});
	});

	describe('Key Sorting', () => {
		function sortKeysRecursive(obj: unknown): unknown {
			if (Array.isArray(obj)) {
				return obj.map((item) => sortKeysRecursive(item));
			} else if (typeof obj === 'object' && obj !== null) {
				const sorted: Record<string, unknown> = {};
				Object.keys(obj)
					.sort()
					.forEach((key) => {
						sorted[key] = sortKeysRecursive((obj as Record<string, unknown>)[key]);
					});
				return sorted;
			}
			return obj;
		}

		bench('Sort keys 100KB JSON', () => {
			const parsed = JSON.parse(small);
			sortKeysRecursive(parsed);
		});

		bench('Sort keys 1MB JSON', () => {
			const parsed = JSON.parse(medium);
			sortKeysRecursive(parsed);
		});
	});

	describe('Statistics Calculation', () => {
		function calculateStats(content: string) {
			const parsed = JSON.parse(content);
			const stats = {
				objects: 0,
				arrays: 0,
				keys: 0,
				depth: 0,
				lines: content.split('\n').length
			};

			function traverse(obj: unknown, currentDepth = 0): void {
				stats.depth = Math.max(stats.depth, currentDepth);

				if (Array.isArray(obj)) {
					stats.arrays++;
					obj.forEach((item) => {
						if (typeof item === 'object' && item !== null) {
							traverse(item, currentDepth + 1);
						}
					});
				} else if (typeof obj === 'object' && obj !== null) {
					stats.objects++;
					const keys = Object.keys(obj);
					stats.keys += keys.length;

					keys.forEach((key) => {
						const value = (obj as Record<string, unknown>)[key];
						if (typeof value === 'object' && value !== null) {
							traverse(value, currentDepth + 1);
						}
					});
				}
			}

			traverse(parsed);
			return stats;
		}

		bench('Calculate stats 100KB JSON', () => {
			calculateStats(small);
		});

		bench('Calculate stats 1MB JSON', () => {
			calculateStats(medium);
		});
	});
});
