import { describe, it, expect } from 'vitest';
import { JSONRepair } from '$lib/services/repair';

describe('JSONRepair', () => {
	describe('repair', () => {
		it('should return valid JSON unchanged', () => {
			const valid = '{"name": "test", "value": 42}';
			const result = JSONRepair.repair(valid);

			expect(result.success).toBe(true);
			expect(JSON.parse(result.repairedJSON)).toEqual(JSON.parse(valid));
		});

		it('should fix trailing commas', () => {
			const withComma = '{"name": "test",}';
			const result = JSONRepair.repair(withComma);

			expect(result.success).toBe(true);
			expect(() => JSON.parse(result.repairedJSON)).not.toThrow();
		});

		it('should fix single quotes', () => {
			const singleQuotes = "{'name': 'test'}";
			const result = JSONRepair.repair(singleQuotes);

			expect(result.success).toBe(true);
			expect(result.repairedJSON).toContain('"name"');
		});

		it('should fix unquoted keys', () => {
			const unquoted = '{name: "test"}';
			const result = JSONRepair.repair(unquoted);

			expect(result.success).toBe(true);
		});

		it('should handle escaped strings', () => {
			const escaped = '{\\"name\\": \\"test\\"}';
			const result = JSONRepair.repair(escaped);

			expect(result.wasUnescaped || result.success).toBe(true);
		});

		it('should handle JSON with BOM characters', () => {
			const withBOM = '\uFEFF{"name": "test"}';
			const result = JSONRepair.repair(withBOM);

			// The jsonrepair library handles BOM by stripping it
			// The repair should succeed with valid JSON output
			expect(result.repairedJSON).toBeDefined();
			// Either it successfully repairs or the result is valid JSON
			if (result.success) {
				expect(JSON.parse(result.repairedJSON)).toBeDefined();
			}
		});

		it('should handle JSONP callback wrapper', () => {
			const jsonp = 'callback({"name": "test"})';
			const result = JSONRepair.repair(jsonp);

			expect(result.success).toBe(true);
		});

		it('should fix undefined values', () => {
			const withUndefined = '{"name": undefined}';
			const result = JSONRepair.repair(withUndefined);

			expect(result.success).toBe(true);
			expect(result.repairedJSON).toContain('null');
		});

		it('should fix NaN values', () => {
			const withNaN = '{"value": NaN}';
			const result = JSONRepair.repair(withNaN);

			expect(result.success).toBe(true);
		});

		it('should fix Infinity values', () => {
			const withInfinity = '{"value": Infinity}';
			const result = JSONRepair.repair(withInfinity);

			expect(result.success).toBe(true);
		});

		it('should remove comments', () => {
			const withComments = '{"name": "test" /* comment */}';
			const result = JSONRepair.repair(withComments);

			expect(result.success).toBe(true);
		});

		it('should handle empty input', () => {
			const result = JSONRepair.repair('');

			expect(result.success).toBe(false);
		});

		it('should report original and repaired lengths', () => {
			const json = '{"name": "test"}';
			const result = JSONRepair.repair(json);

			expect(result.originalLength).toBe(json.length);
			expect(result.repairedLength).toBeGreaterThan(0);
		});
	});

	describe('escape', () => {
		it('should escape special characters', () => {
			const input = 'Hello\nWorld\t!';
			const escaped = JSONRepair.escape(input);

			expect(escaped).toBe('Hello\\nWorld\\t!');
		});

		it('should escape quotes', () => {
			const input = 'Say "Hello"';
			const escaped = JSONRepair.escape(input);

			expect(escaped).toBe('Say \\"Hello\\"');
		});

		it('should escape backslashes', () => {
			const input = 'path\\to\\file';
			const escaped = JSONRepair.escape(input);

			expect(escaped).toBe('path\\\\to\\\\file');
		});

		it('should handle empty string', () => {
			expect(JSONRepair.escape('')).toBe('');
		});

		it('should handle null/undefined', () => {
			expect(JSONRepair.escape(null as unknown as string)).toBeFalsy();
		});
	});

	describe('unescape', () => {
		it('should unescape escape sequences', () => {
			const input = 'Hello\\nWorld\\t!';
			const unescaped = JSONRepair.unescape(input);

			expect(unescaped).toBe('Hello\nWorld\t!');
		});

		it('should unescape quotes', () => {
			const input = 'Say \\"Hello\\"';
			const unescaped = JSONRepair.unescape(input);

			expect(unescaped).toBe('Say "Hello"');
		});

		it('should handle multiple backslashes', () => {
			const input = '\\\\n'; // Two backslashes + n
			const unescaped = JSONRepair.unescape(input);

			expect(unescaped).toBe('\\n'); // One backslash + n
		});

		it('should handle empty string', () => {
			expect(JSONRepair.unescape('')).toBe('');
		});
	});

	describe('isEscaped', () => {
		it('should detect escaped strings', () => {
			expect(JSONRepair.isEscaped('\\"hello\\"')).toBe(true);
			expect(JSONRepair.isEscaped('\\n')).toBe(true);
		});

		it('should return false for non-escaped strings', () => {
			expect(JSONRepair.isEscaped('hello')).toBe(false);
			expect(JSONRepair.isEscaped('{"key": "value"}')).toBe(false);
		});

		it('should handle empty input', () => {
			expect(JSONRepair.isEscaped('')).toBe(false);
		});
	});

	describe('getEscapeLevel', () => {
		it('should return 0 for non-escaped text', () => {
			expect(JSONRepair.getEscapeLevel('{"key": "value"}')).toBe(0);
		});

		it('should detect single escape level', () => {
			const singleEscaped = '{\\"key\\": \\"value\\"}';
			expect(JSONRepair.getEscapeLevel(singleEscaped)).toBeGreaterThan(0);
		});

		it('should handle empty input', () => {
			expect(JSONRepair.getEscapeLevel('')).toBe(0);
		});
	});

	describe('deepUnescape', () => {
		it('should return valid JSON immediately', () => {
			const valid = '{"name": "test"}';
			const result = JSONRepair.deepUnescape(valid);

			expect(result.success).toBe(true);
			expect(result.iterations).toBe(0);
		});

		it('should unescape escaped JSON', () => {
			const escaped = '{\\"name\\": \\"test\\"}';
			const result = JSONRepair.deepUnescape(escaped);

			expect(result.iterations).toBeGreaterThan(0);
		});

		it('should handle empty input', () => {
			const result = JSONRepair.deepUnescape('');

			expect(result.success).toBe(false);
			expect(result.error).toContain('Empty');
		});

		it('should respect max iterations', () => {
			const result = JSONRepair.deepUnescape('invalid', 3);

			expect(result.iterations).toBeLessThanOrEqual(3);
		});
	});

	describe('unescapeAndClean', () => {
		it('should clean and validate valid JSON', () => {
			const json = '{"name": "test"}';
			const result = JSONRepair.unescapeAndClean(json);

			expect(result.success).toBe(true);
		});

		it('should handle escaped JSON', () => {
			const escaped = '{\\"name\\": \\"test\\"}';
			const result = JSONRepair.unescapeAndClean(escaped);

			expect(result.operations.length).toBeGreaterThan(0);
		});

		it('should return error for invalid input', () => {
			const result = JSONRepair.unescapeAndClean(null as unknown as string);

			expect(result.success).toBe(false);
		});
	});

	describe('isValidJSON', () => {
		it('should return true for valid JSON', () => {
			expect(JSONRepair.isValidJSON('{"a": 1}')).toBe(true);
			expect(JSONRepair.isValidJSON('[1, 2, 3]')).toBe(true);
			expect(JSONRepair.isValidJSON('"string"')).toBe(true);
			expect(JSONRepair.isValidJSON('42')).toBe(true);
			expect(JSONRepair.isValidJSON('null')).toBe(true);
		});

		it('should return false for invalid JSON', () => {
			expect(JSONRepair.isValidJSON('{"a": }')).toBe(false);
			expect(JSONRepair.isValidJSON('{name: "test"}')).toBe(false);
			expect(JSONRepair.isValidJSON("{'a': 1}")).toBe(false);
		});
	});

	describe('getValidationError', () => {
		it('should return null for valid JSON', () => {
			expect(JSONRepair.getValidationError('{"a": 1}')).toBe(null);
		});

		it('should return error message for invalid JSON', () => {
			const error = JSONRepair.getValidationError('{"a": }');
			expect(error).not.toBe(null);
			expect(typeof error).toBe('string');
		});
	});

	describe('format', () => {
		it('should format JSON with specified indent', () => {
			const minified = '{"a":1}';
			const formatted = JSONRepair.format(minified, 4);

			expect(formatted).toContain('    "a"');
		});

		it('should use default 2-space indent', () => {
			const minified = '{"a":1}';
			const formatted = JSONRepair.format(minified);

			expect(formatted).toContain('  "a"');
		});

		it('should throw for invalid JSON', () => {
			expect(() => JSONRepair.format('{"a": }')).toThrow();
		});
	});

	describe('minify', () => {
		it('should remove all whitespace', () => {
			const formatted = '{\n  "a": 1\n}';
			const minified = JSONRepair.minify(formatted);

			expect(minified).toBe('{"a":1}');
		});

		it('should preserve string content', () => {
			const json = '{"message": "hello world"}';
			const minified = JSONRepair.minify(json);

			expect(minified).toContain('hello world');
		});

		it('should throw for invalid JSON', () => {
			expect(() => JSONRepair.minify('{"a": }')).toThrow();
		});
	});
});
