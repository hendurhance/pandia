// Escape/Unescape implementation based on json4u:
// https://github.com/loggerhead/json4u/blob/main/src/lib/worker/command/escape.ts

import { jsonrepair } from 'jsonrepair';

export interface RepairResult {
	readonly success: boolean;
	readonly repairedJSON: string;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
	readonly originalLength: number;
	readonly repairedLength: number;
	readonly wasUnescaped: boolean;
	readonly cleanedUp: boolean;
}

export class JSONRepair {
	/**
	 * Escape character mappings
	 * Maps special characters to their escaped equivalents
	 */
	private static readonly ESCAPE_MAP: Record<string, string> = {
		'\\': '\\\\',
		'"': '\\"',
		'\b': '\\b',
		'\f': '\\f',
		'\n': '\\n',
		'\r': '\\r',
		'\t': '\\t',
	};

	/**
	 * Unescape character mappings
	 * Maps escape sequences to their actual characters
	 */
	private static readonly UNESCAPE_MAP: Record<string, string> = {
		'b': '\b',
		'f': '\f',
		'n': '\n',
		'r': '\r',
		't': '\t',
		'"': '"',
		'\\': '\\',
	};

	/**
	 * Regex for escaping special characters
	 * Matches: backslash, quote, control characters (0x00-0x1F), and forward slash
	 */
	private static readonly ESCAPE_RE = /[\\"\u0000-\u001F\/]/g;

	/**
	 * Regex for unescaping strings
	 * Matches: one or more backslashes followed by any character
	 * This broader pattern is the key improvement from json4u
	 */
	private static readonly UNESCAPE_RE = /(\\+)(.)/g;

	/**
	 * Common JSON repair patterns
	 * Each tuple contains: [pattern regex, replacement string]
	 */
	private static readonly COMMON_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
		// Fix trailing commas in objects and arrays
		[/,(\s*[}\]])/g, '$1'],
		
		// Fix unquoted keys (basic cases)
		[/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":'],
		
		// Fix single quotes to double quotes
		[/'/g, '"'],
		
		// Fix undefined values
		[/:\s*undefined/gi, ': null'],
		
		// Fix NaN values
		[/:\s*NaN/gi, ': null'],
		
		// Fix Infinity values
		[/:\s*Infinity/gi, ': null'],
		[/:\s*-Infinity/gi, ': null'],
		
		// Fix duplicate commas
		[/,,+/g, ','],
		
		// Fix comments (remove them)
		[/\/\*[\s\S]*?\*\//g, ''],
		[/\/\/.*$/gm, ''],
		
		// Fix semicolons instead of commas
		[/;(\s*["\w\[])/g, ',$1'],
	];

	/**
	 * Escapes special characters in text to JSON-safe format
	 * Based on json4u implementation
	 * 
	 * @param text - Text to escape
	 * @returns Escaped text safe for JSON
	 * 
	 * @example
	 * escape('Hello\n"World"') // returns 'Hello\\n\\"World\\"'
	 */
	static escape(text: string): string {
		if (!text) return text;
		return text.replace(this.ESCAPE_RE, (ch) => this.ESCAPE_MAP[ch] || ch);
	}

	/**
	 * Unescapes a JSON string that may have been escaped
	 * Based on json4u implementation with proper handling of multiple backslashes
	 * 
	 * Key improvement: Uses broader regex /(\\+)(.)/g to match ANY character after backslashes,
	 * not just specific escape sequences. This handles edge cases much better.
	 * 
	 * Algorithm:
	 * 1. Matches sequences of backslashes followed by any character
	 * 2. Counts the backslashes:
	 *    - Even count (e.g., \\\\n): Half the backslashes, keep the character as-is
	 *    - Odd count (e.g., \\\n): Half the backslashes (rounded down), unescape the character
	 * 3. Only unescapes known escape sequences from UNESCAPE_MAP for odd backslash counts
	 * 
	 * @param text - Text to unescape
	 * @returns Unescaped text
	 * 
	 * @example
	 * unescape('\\"hello\\"') // returns '"hello"'
	 * unescape('\\\\n') // returns '\\n' (one backslash + n, not a newline)
	 * unescape('\\n') // returns '\n' (actual newline character)
	 */
	static unescape(text: string): string {
		if (!text) return text;
		
		return text.replace(this.UNESCAPE_RE, (_match, backslashes, char) => {
			const backslashCount = backslashes.length;
			const halfCount = backslashCount >> 1; // Equivalent to Math.floor(backslashCount / 2)
			const prefix = '\\'.repeat(halfCount);
			
			// If odd number of backslashes AND character has a known unescape mapping
			if (backslashCount % 2 === 1 && this.UNESCAPE_MAP[char] !== undefined) {
				return prefix + this.UNESCAPE_MAP[char];
			}
			
			// Even number of backslashes OR unknown character: keep as-is
			return prefix + (backslashCount % 2 ? '\\' : '') + char;
		});
	}

	/**
	 * Detects if text contains escaped sequences
	 * 
	 * @param text - Text to check
	 * @returns true if text contains escape sequences
	 */
	static isEscaped(text: string): boolean {
		if (!text) return false;
		
		// Sample for large files to improve performance
		const sampleText = text.length > 100000 
			? text.substring(0, 50000) + text.substring(text.length - 50000)
			: text;
		
		// Check for common escape patterns
		return /\\+["/nrtbf]/.test(sampleText);
	}

	/**
	 * Estimates the level of escaping in the text
	 * 
	 * @param text - Text to analyze
	 * @returns Estimated escape level (number of times escaped)
	 */
	static getEscapeLevel(text: string): number {
		if (!text) return 0;
		
		// Sample for performance on large files
		const sampleText = text.length > 50000 ? text.substring(0, 50000) : text;
		const quoteMatches = sampleText.match(/\\+"/g);
		
		if (!quoteMatches || quoteMatches.length === 0) return 0;
		
		// Analyze first few matches to determine escape level
		const sample = quoteMatches.slice(0, Math.min(10, quoteMatches.length));
		const escapeLengths = sample.map(match => match.length - 1);
		const maxEscapeLength = Math.max(...escapeLengths);
		
		return Math.floor(maxEscapeLength / 2) + (maxEscapeLength % 2);
	}

	/**
	 * Recursively unescapes JSON string until valid or max iterations reached
	 * 
	 * @param text - Text to unescape
	 * @param maxIterations - Maximum unescape iterations (default: 5)
	 * @returns Result object with unescaped text and metadata
	 */
	static deepUnescape(
		text: string, 
		maxIterations: number = 5
	): { result: string; iterations: number; success: boolean; error?: string } {
		if (!text) {
			return { result: text, iterations: 0, success: false, error: 'Empty input' };
		}
		
		let current = text;
		let iterations = 0;
		
		try {
			while (iterations < maxIterations) {
				// Check if already valid JSON
				try {
					JSON.parse(current);
					return { result: current, iterations, success: true };
				} catch {
					// Continue to unescape
				}
				
				// Check if text is still escaped
				if (!this.isEscaped(current)) {
					break;
				}
				
				const unescaped = this.unescape(current);
				
				// Prevent infinite loops
				if (unescaped === current || unescaped.length === current.length) {
					break;
				}
				
				current = unescaped;
				iterations++;
				
				// Limit iterations for very large files
				if (current.length > 1000000 && iterations > 2) {
					break;
				}
			}
			
			// Final validation
			try {
				JSON.parse(current);
				return { result: current, iterations, success: true };
			} catch (parseError) {
				return { 
					result: current, 
					iterations, 
					success: false, 
					error: `Parse failed after ${iterations} iterations: ${(parseError as Error).message}` 
				};
			}
		} catch (error) {
			return { 
				result: text, 
				iterations, 
				success: false, 
				error: `Unescaping failed: ${(error as Error).message}` 
			};
		}
	}

	/**
	 * Unescapes and cleans up JSON string
	 * Main public method for JSON unescape with validation
	 * 
	 * @param jsonString - JSON string to unescape and clean
	 * @returns Result object with success status, cleaned result, and operation log
	 */
	static unescapeAndClean(jsonString: string): { 
		success: boolean; 
		result: string; 
		operations: string[] 
	} {
		if (!jsonString || typeof jsonString !== 'string') {
			return { 
				success: false, 
				result: jsonString, 
				operations: ['Input is not a valid string'] 
			};
		}

		let current = jsonString.trim();
		const operations: string[] = [];
		
		try {
			// Step 1: Deep unescape if needed
			if (this.isEscaped(current)) {
				const escapeLevel = this.getEscapeLevel(current);
				const unescapeResult = this.deepUnescape(current);
				
				if (unescapeResult.error) {
					operations.push(`Unescape error: ${unescapeResult.error}`);
				}
				
				if (unescapeResult.iterations > 0) {
					current = unescapeResult.result;
					operations.push(
						`Applied ${unescapeResult.iterations} levels of unescaping ` +
						`(detected escape level: ${escapeLevel})`
					);
				}
				
				if (unescapeResult.success) {
					try {
						const formatted = current.length > 500000
							? JSON.stringify(JSON.parse(current))
							: JSON.stringify(JSON.parse(current), null, 2);
						return { success: true, result: formatted, operations };
					} catch {
						// Continue with cleanup if formatting fails
					}
				}
			}
			
			// Step 2: Basic cleanup
			const tempWarnings: string[] = [];
			
			const cleaned = this.basicCleanup(current, { warnings: tempWarnings });
			if (cleaned !== current) {
				current = cleaned;
				operations.push('Applied basic cleanup');
			}
			
			// Step 3: Validate result
			try {
				const parsed = JSON.parse(current);
				const formatted = current.length > 500000 
					? JSON.stringify(parsed) 
					: JSON.stringify(parsed, null, 2);
				return { success: true, result: formatted, operations };
			} catch (error) {
				return { 
					success: false, 
					result: current, 
					operations: [...operations, `Parse failed: ${(error as Error).message}`] 
				};
			}
		} catch (error) {
			return { 
				success: false, 
				result: jsonString, 
				operations: [`Fatal error: ${(error as Error).message}`] 
			};
		}
	}

	/**
	 * Attempts to repair malformed JSON string
	 */
	static repair(jsonString: string): RepairResult {
		const errors: string[] = [];
		const warnings: string[] = [];
		
		const result: Omit<RepairResult, 'errors' | 'warnings'> & { errors: string[]; warnings: string[] } = {
			success: false,
			repairedJSON: jsonString,
			errors,
			warnings,
			originalLength: jsonString.length,
			repairedLength: 0,
			wasUnescaped: false,
			cleanedUp: false,
		};

		if (!jsonString || typeof jsonString !== 'string') {
			result.errors.push('Input is not a valid string');
			return { ...result, errors: result.errors, warnings: result.warnings };
		}

		let repaired = jsonString.trim();
		const originalJSON = repaired;

		try {
			JSON.parse(repaired);
			return {
				...result,
				success: true,
				repairedJSON: JSON.stringify(JSON.parse(repaired), null, 2),
				repairedLength: JSON.stringify(JSON.parse(repaired), null, 2).length,
				errors: result.errors,
				warnings: result.warnings
			};
		} catch (initialError) {
			result.warnings.push(`Initial parse failed: ${(initialError as Error).message}`);
		}

		if (this.isEscaped(repaired)) {
			const escapeLevel = this.getEscapeLevel(repaired);
			const unescapeResult = this.deepUnescape(repaired);
			
			if (unescapeResult.error) {
				result.warnings.push(`Unescape warning: ${unescapeResult.error}`);
			}
			
			if (unescapeResult.success) {
				const formatted = unescapeResult.result.length > 500000 
					? JSON.stringify(JSON.parse(unescapeResult.result))
					: JSON.stringify(JSON.parse(unescapeResult.result), null, 2);
				return {
					...result,
					success: true,
					repairedJSON: formatted,
					repairedLength: formatted.length,
					wasUnescaped: true,
					errors: result.errors,
					warnings: [...result.warnings, `Applied ${unescapeResult.iterations} levels of unescaping (detected escape level: ${escapeLevel})`]
				};
			} else if (unescapeResult.iterations > 0) {
				repaired = unescapeResult.result;
				result.warnings.push(`Applied ${unescapeResult.iterations} levels of unescaping (partial fix, detected escape level: ${escapeLevel})`);
			}
		}

		const tempWarnings = [...result.warnings];
		const cleanedUp = this.basicCleanup(repaired, { warnings: tempWarnings });
		const wasCleanedUp = cleanedUp !== repaired;
		if (wasCleanedUp) {
			repaired = cleanedUp;
		}

		try {
			const repairedByLibrary = jsonrepair(repaired);
			const parsed = JSON.parse(repairedByLibrary);
			const formatted = repairedByLibrary.length > 500000 
				? JSON.stringify(parsed)
				: JSON.stringify(parsed, null, 2);
			
			const finalWarnings = [...tempWarnings, 'Repaired using jsonrepair library'];
			if (formatted !== originalJSON) {
				finalWarnings.push('JSON was modified during repair');
			}
			
			return {
				...result,
				success: true,
				repairedJSON: formatted,
				repairedLength: formatted.length,
				cleanedUp: wasCleanedUp,
				errors: result.errors,
				warnings: finalWarnings
			};
			
		} catch (libraryError) {
			tempWarnings.push(`Library repair failed: ${(libraryError as Error).message}`);
		}

		const repairWarnings = [...tempWarnings];
		repaired = this.applyCommonFixes(repaired, { warnings: repairWarnings });
		repaired = this.advancedRepairs(repaired, { warnings: repairWarnings });

		try {
			const parsed = JSON.parse(repaired);
			const formatted = repaired.length > 500000 
				? JSON.stringify(parsed)
				: JSON.stringify(parsed, null, 2);
			
			const finalWarnings = [...repairWarnings];
			if (formatted !== originalJSON) {
				finalWarnings.push('JSON was modified during repair');
			}
			
			return {
				...result,
				success: true,
				repairedJSON: formatted,
				repairedLength: formatted.length,
				cleanedUp: wasCleanedUp,
				errors: result.errors,
				warnings: finalWarnings
			};
			
		} catch (finalError) {
			return {
				...result,
				repairedJSON: originalJSON,
				cleanedUp: wasCleanedUp,
				errors: [...result.errors, `Final parse failed: ${(finalError as Error).message}`],
				warnings: repairWarnings
			};
		}
	}	private static basicCleanup(json: string, result: { warnings: string[] }): string {
		let cleaned = json;

		// Remove BOM if present
		if (cleaned.charCodeAt(0) === 0xFEFF) {
			cleaned = cleaned.slice(1);
			result.warnings.push('Removed BOM (Byte Order Mark)');
		}

		// Normalize line endings
		cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

		// Remove leading/trailing whitespace
		cleaned = cleaned.trim();

		// Handle common wrapper issues
		if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
			cleaned = cleaned.slice(1, -1).trim();
			result.warnings.push('Removed parentheses wrapper');
		}

		// Handle JSONP callbacks
		const jsonpMatch = cleaned.match(/^\w+\s*\(\s*(.*)\s*\)$/);
		if (jsonpMatch) {
			cleaned = jsonpMatch[1].trim();
			result.warnings.push('Removed JSONP callback wrapper');
		}

		return cleaned;
	}

	private static applyCommonFixes(json: string, result: { warnings: string[] }): string {
		let fixed = json;

		for (const [regex, replacement] of this.COMMON_REPLACEMENTS) {
			const before = fixed;
			fixed = fixed.replace(regex, replacement);
			if (fixed !== before) {
				result.warnings.push(`Applied fix: ${regex.toString()}`);
			}
		}

		return fixed;
	}

	private static advancedRepairs(json: string, result: { warnings: string[] }): string {
		let repaired = json;

		repaired = this.fixBracketMismatches(repaired, result);
		repaired = this.fixUnquotedKeys(repaired, result);
		repaired = this.fixStringEscaping(repaired, result);
		repaired = this.fixJavaScriptLiterals(repaired);

		return repaired;
	}

	private static fixBracketMismatches(json: string, result: { warnings: string[] }): string {
		const stack: string[] = [];
		let fixed = '';
		let i = 0;

		while (i < json.length) {
			const char = json[i];

			if (char === '"') {
				// Handle string literals - skip to end of string
				fixed += char;
				i++;
				while (i < json.length && json[i] !== '"') {
					if (json[i] === '\\') {
						fixed += json[i] + (json[i + 1] || '');
						i += 2;
					} else {
						fixed += json[i];
						i++;
					}
				}
				if (i < json.length) {
					fixed += json[i]; // closing quote
				}
			} else if (char === '{' || char === '[') {
				stack.push(char);
				fixed += char;
			} else if (char === '}' || char === ']') {
				const expected = char === '}' ? '{' : '[';
				const last = stack.pop();
				
				if (last === expected) {
					fixed += char;
				} else if (last) {
					// Mismatch - try to fix
					const correctClosing = last === '{' ? '}' : ']';
					fixed += correctClosing;
					result.warnings.push(`Fixed bracket mismatch: expected '${correctClosing}' but found '${char}'`);
				} else {
					// Extra closing bracket - skip it
					result.warnings.push(`Removed extra closing bracket '${char}'`);
				}
			} else {
				fixed += char;
			}
			i++;
		}

		// Close any remaining open brackets
		while (stack.length > 0) {
			const bracket = stack.pop();
			const closing = bracket === '{' ? '}' : ']';
			fixed += closing;
			result.warnings.push(`Added missing closing bracket '${closing}'`);
		}

		return fixed;
	}

	private static fixUnquotedKeys(json: string, result: { warnings: string[] }): string {
		// More sophisticated unquoted key detection
		let fixed = json;
		
		// Match unquoted keys that are valid JavaScript identifiers
		const keyRegex = /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g;
		let match;
		
		while ((match = keyRegex.exec(fixed)) !== null) {
			const fullMatch = match[0];
			const prefix = match[1];
			const key = match[2];
			
			// Check if the key is already quoted or is a JavaScript keyword that should be quoted
			if (!this.isQuoted(key) && this.shouldBeQuoted(key)) {
				const replacement = `${prefix}"${key}":`;
				fixed = fixed.replace(fullMatch, replacement);
				result.warnings.push(`Added quotes around key: ${key}`);
			}
		}

		return fixed;
	}

	private static fixStringEscaping(json: string, result: { warnings: string[] }): string {
		let fixed = json;
		
		// Fix common escaping issues
		const escapeIssues: Array<[RegExp, string | ((match: string) => string)]> = [
			// Fix unescaped backslashes
			[/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\'],
			
			// Fix unescaped control characters
			[/[\x00-\x1F]/g, (match: string) => {
				const char = match.charCodeAt(0);
				switch (char) {
					case 8: return '\\b';
					case 9: return '\\t';
					case 10: return '\\n';
					case 12: return '\\f';
					case 13: return '\\r';
					default: return `\\u${char.toString(16).padStart(4, '0')}`;
				}
			}],
		];

		for (const [regex, replacement] of escapeIssues) {
			const before = fixed;
			if (typeof replacement === 'string') {
				fixed = fixed.replace(regex, replacement);
			} else {
				fixed = fixed.replace(regex, replacement as (substring: string, ...args: any[]) => string);
			}
			if (fixed !== before) {
				result.warnings.push('Fixed string escaping issues');
			}
		}

		return fixed;
	}

	private static fixJavaScriptLiterals(json: string): string {
		let fixed = json;

		// Convert JavaScript object notation to JSON
		const jsObjectRegex = /(\w+)\s*:\s*([^,}\]]+)/g;
		
		fixed = fixed.replace(jsObjectRegex, (match, key, value) => {
			// Don't modify if already quoted or if it's inside a string
			if (this.isQuoted(key) || this.isInsideString(json, match)) {
				return match;
			}

			// Quote the key if it's not already quoted
			let quotedKey = this.isQuoted(key) ? key : `"${key}"`;
			
			// Handle the value
			let processedValue = value.trim();
			
			// If value looks like an unquoted string, quote it
			if (!this.isQuoted(processedValue) && 
				!this.isNumber(processedValue) && 
				!this.isBoolean(processedValue) && 
				processedValue !== 'null') {
				processedValue = `"${processedValue}"`;
			}

			const result = `${quotedKey}: ${processedValue}`;
			return result;
		});

		return fixed;
	}

	private static isQuoted(str: string): boolean {
		return (str.startsWith('"') && str.endsWith('"')) || 
			   (str.startsWith("'") && str.endsWith("'"));
	}

	private static shouldBeQuoted(key: string): boolean {
		// JavaScript reserved words and keywords that should be quoted in JSON
		const keywords = [
			'abstract', 'arguments', 'await', 'boolean', 'break', 'byte', 'case', 'catch',
			'char', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
			'double', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'final',
			'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import',
			'in', 'instanceof', 'int', 'interface', 'let', 'long', 'native', 'new', 'null',
			'package', 'private', 'protected', 'public', 'return', 'short', 'static',
			'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
			'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with', 'yield'
		];
		
		return keywords.includes(key.toLowerCase()) || !(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key));
	}

	private static isInsideString(fullJson: string, match: string): boolean {
		const index = fullJson.indexOf(match);
		if (index === -1) return false;

		let inString = false;
		let escaped = false;

		for (let i = 0; i < index; i++) {
			const char = fullJson[i];
			
			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = !inString;
			}
		}

		return inString;
	}

	private static isNumber(str: string): boolean {
		return !isNaN(Number(str)) && !isNaN(parseFloat(str));
	}

	private static isBoolean(str: string): boolean {
		return str === 'true' || str === 'false';
	}

	/**
	 * Quick validation check for JSON string
	 */
	static isValidJSON(jsonString: string): boolean {
		try {
			JSON.parse(jsonString);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get detailed error information for invalid JSON
	 */
	static getValidationError(jsonString: string): string | null {
		try {
			JSON.parse(jsonString);
			return null;
		} catch (error) {
			return (error as Error).message;
		}
	}

	/**
	 * Format JSON with proper indentation
	 */
	static format(jsonString: string, indent: number = 2): string {
		try {
			const parsed = JSON.parse(jsonString);
			return JSON.stringify(parsed, null, indent);
		} catch (error) {
			throw new Error(`Cannot format invalid JSON: ${(error as Error).message}`);
		}
	}

	/**
	 * Minify JSON by removing whitespace
	 */
	static minify(jsonString: string): string {
		try {
			const parsed = JSON.parse(jsonString);
			return JSON.stringify(parsed);
		} catch (error) {
			throw new Error(`Cannot minify invalid JSON: ${(error as Error).message}`);
		}
	}
}