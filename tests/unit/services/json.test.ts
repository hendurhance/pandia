import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jsonUtils } from '$lib/services/json';
import { sampleJSON } from '../../setup/test-utils';

describe('jsonUtils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('validate', () => {
		it('should return true for valid JSON', async () => {
			const result = await jsonUtils.validate(sampleJSON.valid);
			expect(result).toBe(true);
		});

		it('should throw error for invalid JSON', async () => {
			await expect(jsonUtils.validate(sampleJSON.invalid)).rejects.toThrow();
		});

		it('should handle empty object', async () => {
			const result = await jsonUtils.validate(sampleJSON.empty);
			expect(result).toBe(true);
		});

		it('should handle arrays', async () => {
			const result = await jsonUtils.validate(sampleJSON.array);
			expect(result).toBe(true);
		});

		it('should handle complex nested JSON', async () => {
			const result = await jsonUtils.validate(sampleJSON.complex);
			expect(result).toBe(true);
		});
	});

	describe('format', () => {
		it('should format JSON with default indent', async () => {
			const minified = '{"a":1,"b":2}';
			const result = await jsonUtils.format(minified);
			expect(result).toContain('\n');
			expect(result).toContain('  '); // 2-space indent
		});

		it('should format JSON with custom indent', async () => {
			const minified = '{"a":1}';
			const result = await jsonUtils.format(minified, 4);
			expect(result).toContain('    '); // 4-space indent
		});

		it('should throw for invalid JSON', async () => {
			await expect(jsonUtils.format(sampleJSON.invalid)).rejects.toThrow();
		});
	});

	describe('compress', () => {
		it('should remove whitespace from JSON', async () => {
			const formatted = '{\n  "a": 1,\n  "b": 2\n}';
			const result = await jsonUtils.compress(formatted);
			expect(result).toBe('{"a":1,"b":2}');
		});

		it('should preserve string content with spaces', async () => {
			const json = '{"message": "hello world"}';
			const result = await jsonUtils.compress(json);
			expect(result).toContain('hello world');
		});
	});

	describe('getStats', () => {
		it('should calculate JSON statistics', async () => {
			const json = '{"a": {"b": 1}, "c": [1, 2, 3]}';
			const stats = await jsonUtils.getStats(json);

			expect(stats.raw).toBeGreaterThan(0);
			expect(stats.gzip).toBeLessThan(stats.raw);
			expect(stats.brotli).toBeLessThan(stats.gzip);
		});
	});

	describe('calculateAdditionalStats', () => {
		it('should count objects, arrays, and keys', () => {
			const json = '{"items": [{"id": 1}, {"id": 2}], "meta": {"count": 2}}';
			const stats = jsonUtils.calculateAdditionalStats(json);

			expect(stats.objects).toBe(4); // root, 2 items, meta
			expect(stats.arrays).toBe(1);
			expect(stats.keys).toBe(5); // items, meta, 2x id, count
			expect(stats.depth).toBeGreaterThan(0);
			expect(stats.lines).toBeGreaterThan(0);
		});

		it('should handle empty object', () => {
			const stats = jsonUtils.calculateAdditionalStats('{}');
			expect(stats.objects).toBe(1);
			expect(stats.arrays).toBe(0);
			expect(stats.keys).toBe(0);
		});

		it('should handle empty array', () => {
			const stats = jsonUtils.calculateAdditionalStats('[]');
			expect(stats.objects).toBe(0);
			expect(stats.arrays).toBe(1);
		});

		it('should handle invalid JSON gracefully', () => {
			const stats = jsonUtils.calculateAdditionalStats(sampleJSON.invalid);
			expect(stats.objects).toBe(0);
			expect(stats.arrays).toBe(0);
		});

		it('should count deeply nested structures', () => {
			const json = '{"a": {"b": {"c": {"d": 1}}}}';
			const stats = jsonUtils.calculateAdditionalStats(json);
			expect(stats.depth).toBeGreaterThanOrEqual(3);
		});
	});

	describe('sortKeys', () => {
		it('should sort top-level keys alphabetically', async () => {
			const unsorted = '{"c": 3, "a": 1, "b": 2}';
			const result = await jsonUtils.sortKeys(unsorted);
			const parsed = JSON.parse(result);
			expect(Object.keys(parsed)).toEqual(['a', 'b', 'c']);
		});

		it('should not sort nested keys when recursive is false', async () => {
			const unsorted = '{"b": {"d": 2, "c": 1}, "a": 1}';
			const result = await jsonUtils.sortKeys(unsorted, false);
			const parsed = JSON.parse(result);
			expect(Object.keys(parsed)).toEqual(['a', 'b']);
			expect(Object.keys(parsed.b)).toEqual(['d', 'c']);
		});

		it('should sort keys recursively when enabled', async () => {
			const unsorted = '{"b": {"d": 2, "c": 1}, "a": 1}';
			const result = await jsonUtils.sortKeys(unsorted, true);
			const parsed = JSON.parse(result);
			expect(Object.keys(parsed)).toEqual(['a', 'b']);
			expect(Object.keys(parsed.b)).toEqual(['c', 'd']);
		});

		it('should handle arrays correctly', async () => {
			const json = '{"items": [3, 1, 2]}';
			const result = await jsonUtils.sortKeys(json, true);
			const parsed = JSON.parse(result);
			expect(parsed.items).toEqual([3, 1, 2]); // Arrays should not be sorted
		});
	});

	describe('sortObjectKeys', () => {
		it('should sort object keys', () => {
			const input = { c: 3, a: 1, b: 2 };
			const result = jsonUtils.sortObjectKeys(input, false) as Record<string, number>;
			expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
		});

		it('should preserve primitive values', () => {
			expect(jsonUtils.sortObjectKeys(42, false)).toBe(42);
			expect(jsonUtils.sortObjectKeys('test', false)).toBe('test');
			expect(jsonUtils.sortObjectKeys(null, false)).toBe(null);
		});

		it('should handle arrays of objects', () => {
			const input = [
				{ b: 2, a: 1 },
				{ d: 4, c: 3 }
			];
			const result = jsonUtils.sortObjectKeys(input, true) as Array<Record<string, number>>;
			expect(Object.keys(result[0])).toEqual(['a', 'b']);
			expect(Object.keys(result[1])).toEqual(['c', 'd']);
		});
	});

	describe('convertToYaml', () => {
		it('should convert simple JSON to YAML format', async () => {
			const json = '{"name": "test", "value": 42}';
			const yaml = await jsonUtils.convertToYaml(json);
			expect(yaml).toContain('name:');
			expect(yaml).toContain('value:');
		});

		it('should handle nested objects', async () => {
			const json = '{"outer": {"inner": "value"}}';
			const yaml = await jsonUtils.convertToYaml(json);
			expect(yaml).toContain('outer:');
			expect(yaml).toContain('inner:');
		});

		it('should handle arrays', async () => {
			const json = '{"items": [1, 2, 3]}';
			const yaml = await jsonUtils.convertToYaml(json);
			expect(yaml).toContain('items:');
			expect(yaml).toContain('- ');
		});
	});

	describe('yamlValue', () => {
		it('should quote strings', () => {
			expect(jsonUtils.yamlValue('test')).toBe('"test"');
		});

		it('should handle null', () => {
			expect(jsonUtils.yamlValue(null)).toBe('null');
		});

		it('should handle undefined', () => {
			expect(jsonUtils.yamlValue(undefined)).toBe('~');
		});

		it('should escape special characters', () => {
			const result = jsonUtils.yamlValue('line1\nline2');
			expect(result).toContain('\\n');
		});
	});

	describe('convertToXml', () => {
		it('should convert JSON to XML format', async () => {
			const json = '{"name": "test"}';
			const xml = await jsonUtils.convertToXml(json);
			expect(xml).toContain('<?xml version="1.0"');
			expect(xml).toContain('<name>test</name>');
		});

		it('should wrap in root element', async () => {
			const json = '{"a": 1}';
			const xml = await jsonUtils.convertToXml(json);
			expect(xml).toContain('<root>');
			expect(xml).toContain('</root>');
		});

		it('should handle arrays', async () => {
			const json = '{"items": ["one", "two"]}';
			const xml = await jsonUtils.convertToXml(json);
			expect(xml).toContain('<items>');
		});
	});

	describe('convertToCsv', () => {
		it('should convert array of objects to CSV', async () => {
			const json = '[{"name": "a", "value": 1}, {"name": "b", "value": 2}]';
			const csv = await jsonUtils.convertToCsv(json);
			expect(csv).toContain('name,value');
			expect(csv).toContain('a,1');
			expect(csv).toContain('b,2');
		});

		it('should handle object to CSV', async () => {
			const json = '{"key1": "value1", "key2": "value2"}';
			const csv = await jsonUtils.convertToCsv(json);
			expect(csv).toContain('Key,Value');
			expect(csv).toContain('key1,value1');
		});

		it('should throw for non-object/non-array', async () => {
			await expect(jsonUtils.convertToCsv('"string"')).rejects.toThrow();
		});

		it('should handle empty array', async () => {
			const csv = await jsonUtils.convertToCsv('[]');
			expect(csv).toBe('');
		});
	});

	describe('arrayToCsv', () => {
		it('should create headers from all keys', () => {
			const arr = [
				{ a: 1, b: 2 },
				{ a: 3, c: 4 }
			];
			const csv = jsonUtils.arrayToCsv(arr);
			expect(csv).toContain('a');
			expect(csv).toContain('b');
			expect(csv).toContain('c');
		});

		it('should handle empty array', () => {
			expect(jsonUtils.arrayToCsv([])).toBe('');
		});
	});

	describe('escapeCsvField', () => {
		it('should escape fields with commas', () => {
			expect(jsonUtils.escapeCsvField('a,b')).toBe('"a,b"');
		});

		it('should escape fields with quotes', () => {
			expect(jsonUtils.escapeCsvField('say "hello"')).toBe('"say ""hello"""');
		});

		it('should escape fields with newlines', () => {
			expect(jsonUtils.escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
		});

		it('should not escape simple fields', () => {
			expect(jsonUtils.escapeCsvField('simple')).toBe('simple');
		});
	});

	describe('formatCsvValue', () => {
		it('should return empty string for null', () => {
			expect(jsonUtils.formatCsvValue(null)).toBe('');
		});

		it('should return empty string for undefined', () => {
			expect(jsonUtils.formatCsvValue(undefined)).toBe('');
		});

		it('should stringify objects', () => {
			expect(jsonUtils.formatCsvValue({ a: 1 })).toBe('{"a":1}');
		});

		it('should convert primitives to string', () => {
			expect(jsonUtils.formatCsvValue(42)).toBe('42');
			expect(jsonUtils.formatCsvValue(true)).toBe('true');
		});
	});

	describe('batchValidate', () => {
		it('should validate multiple JSON strings', async () => {
			const contents = [sampleJSON.valid, sampleJSON.nested, sampleJSON.array];
			const result = await jsonUtils.batchValidate(contents);

			expect(result.results).toHaveLength(3);
			expect(result.results.every((r) => r === true)).toBe(true);
			expect(result.errors.every((e) => e === null)).toBe(true);
		});

		it('should handle mixed valid/invalid content', async () => {
			const contents = [sampleJSON.valid, sampleJSON.invalid, sampleJSON.nested];
			const result = await jsonUtils.batchValidate(contents);

			expect(result.results[0]).toBe(true);
			expect(result.results[1]).toBe(null); // Failed
			expect(result.results[2]).toBe(true);
			expect(result.errors[1]).not.toBe(null);
		});
	});

	describe('batchFormat', () => {
		it('should format multiple JSON strings', async () => {
			const contents = ['{"a":1}', '{"b":2}'];
			const result = await jsonUtils.batchFormat(contents);

			expect(result.results).toHaveLength(2);
			expect(result.results.every((r) => r !== null && r.includes('\n'))).toBe(true);
		});
	});

	describe('batchCompress', () => {
		it('should compress multiple JSON strings', async () => {
			const contents = ['{\n  "a": 1\n}', '{\n  "b": 2\n}'];
			const result = await jsonUtils.batchCompress(contents);

			expect(result.results).toHaveLength(2);
			expect(result.results[0]).toBe('{"a":1}');
			expect(result.results[1]).toBe('{"b":2}');
		});
	});
});
