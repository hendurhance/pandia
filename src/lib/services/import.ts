import YAML from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import Papa from 'papaparse';
import { formatError } from '../utils/error';

export const FILE_FORMATS = ['json', 'jsonc', 'jsonl', 'yaml', 'xml', 'csv', 'unknown'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/**
 * File extensions mapped to formats
 */
const EXTENSION_MAP: Readonly<Record<string, FileFormat>> = {
	'.json': 'json',
	'.jsonc': 'jsonc',
	'.jsonl': 'jsonl',
	'.ndjson': 'jsonl',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.xml': 'xml',
	'.csv': 'csv',
	'.tsv': 'csv',
	'.txt': 'unknown',
} as const;

/**
 * Content type patterns for format detection
 */
const CONTENT_PATTERNS: ReadonlyArray<{
	readonly format: FileFormat;
	readonly test: (content: string) => boolean;
}> = [
	{
		format: 'jsonl',
		test: (content) => {
			const lines = content.trim().split('\n').filter(line => line.trim().length > 0);
			// JSONL: multiple lines, each starting with { and ending with }
			if (lines.length < 2) return false;
			return lines.every(line => {
				const trimmed = line.trim();
				return trimmed.startsWith('{') && trimmed.endsWith('}');
			});
		},
	},
	{
		format: 'json',
		test: (content) => {
			const trimmed = content.trim();
			return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			       (trimmed.startsWith('[') && trimmed.endsWith(']'));
		},
	},
	{
		format: 'xml',
		test: (content) => {
			const trimmed = content.trim();
			return trimmed.startsWith('<?xml') || 
			       (trimmed.startsWith('<') && trimmed.includes('</'));
		},
	},
	{
		format: 'yaml',
		test: (content) => {
			const lines = content.trim().split('\n');
			// Filter out comment-only lines and empty lines for detection
			const nonCommentLines = lines.filter(line => {
				const trimmed = line.trim();
				return trimmed.length > 0 && !trimmed.startsWith('#');
			});
			
			// Check for YAML document start marker
			if (lines[0]?.trim().startsWith('---')) {
				return true;
			}
			
			// Check if file has YAML comments (# at start of line)
			const hasYamlComments = lines.some(line => line.trim().startsWith('#'));
			
			// Check for key: value patterns in non-comment lines
			const hasKeyValuePattern = nonCommentLines.some(line => 
				/^[\w-]+:\s*.*$/.test(line.trim())
			);
			
			// YAML if it has comments with key-value patterns, or just key-value patterns
			return hasKeyValuePattern && (hasYamlComments || nonCommentLines.length > 0);
		},
	},
	{
		format: 'csv',
		test: (content) => {
			const lines = content.trim().split('\n');
			if (lines.length < 2) return false;
			// Check if lines have consistent delimiter patterns
			const firstLineCommas = (lines[0].match(/,/g) || []).length;
			const secondLineCommas = (lines[1].match(/,/g) || []).length;
			return firstLineCommas > 0 && firstLineCommas === secondLineCommas;
		},
	},
] as const;

/**
 * Successful parse result
 */
interface ParseSuccess<T = unknown> {
	readonly success: true;
	readonly data: T;
	readonly format: FileFormat;
	readonly originalFormat: FileFormat;
}

/**
 * Failed parse result
 */
interface ParseFailure {
	readonly success: false;
	readonly error: ParseError;
	readonly format: FileFormat;
}

/**
 * Discriminated union for parse results
 */
export type ParseResult<T = unknown> = ParseSuccess<T> | ParseFailure;

/**
 * Structured error information
 */
export interface ParseError {
	readonly message: string;
	readonly code: ParseErrorCode;
	readonly line?: number;
	readonly column?: number;
	readonly cause?: unknown;
}

/**
 * Error codes for categorizing parse failures
 */
export const PARSE_ERROR_CODES = [
	'INVALID_JSON',
	'INVALID_JSONC',
	'INVALID_JSONL',
	'INVALID_YAML',
	'INVALID_XML',
	'INVALID_CSV',
	'EMPTY_CONTENT',
	'UNKNOWN_FORMAT',
	'PARSE_ERROR',
] as const;
export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

/**
 * CSV parsing options
 */
export interface CSVOptions {
	readonly delimiter?: string;
	readonly hasHeaders?: boolean;
	readonly skipEmptyLines?: boolean;
	readonly trimFields?: boolean;
}

/**
 * XML parsing options
 */
export interface XMLOptions {
	readonly explicitArray?: boolean;
	readonly mergeAttrs?: boolean;
	readonly trim?: boolean;
}

/**
 * Import options
 */
export interface ImportOptions {
	readonly format?: FileFormat;
	readonly csv?: CSVOptions;
	readonly xml?: XMLOptions;
	readonly filename?: string;
}

// Helper Functions

/**
 * Creates a successful parse result
 */
function createSuccess<T>(data: T, format: FileFormat, originalFormat: FileFormat): ParseSuccess<T> {
	return Object.freeze({
		success: true as const,
		data,
		format,
		originalFormat,
	});
}

/**
 * Creates a failed parse result
 */
function createFailure(
	code: ParseErrorCode,
	message: string,
	format: FileFormat,
	cause?: unknown
): ParseFailure {
	return Object.freeze({
		success: false as const,
		error: Object.freeze({
			message,
			code,
			cause,
		}),
		format,
	});
}

/**
 * Extracts line and column from JSON parse error
 */
function extractJSONErrorPosition(error: unknown): { line?: number; column?: number } {
	if (error instanceof SyntaxError) {
		const match = error.message.match(/position\s+(\d+)/i);
		if (match) {
			return { column: parseInt(match[1], 10) };
		}
	}
	return {};
}

// Format Detection

/**
 * Detects file format from filename extension
 */
export function detectFormatFromFilename(filename: string): FileFormat {
	const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
	return ext ? (EXTENSION_MAP[ext] ?? 'unknown') : 'unknown';
}

/**
 * Detects file format from content analysis
 */
export function detectFormatFromContent(content: string): FileFormat {
	const trimmed = content.trim();
	
	if (!trimmed) {
		return 'unknown';
	}

	for (const pattern of CONTENT_PATTERNS) {
		if (pattern.test(trimmed)) {
			return pattern.format;
		}
	}

	return 'unknown';
}

/**
 * Detects file format using both filename and content
 */
export function detectFormat(content: string, filename?: string): FileFormat {
	// First try filename if available
	if (filename) {
		const formatFromFilename = detectFormatFromFilename(filename);
		if (formatFromFilename !== 'unknown') {
			return formatFromFilename;
		}
	}

	// Fall back to content detection
	return detectFormatFromContent(content);
}



// Individual Parsers

/**
 * Parses JSON content
 */
function parseJSON(content: string): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'json');
	}

	try {
		const data = JSON.parse(trimmed);
		return createSuccess(data, 'json', 'json');
	} catch (error) {
		const position = extractJSONErrorPosition(error);
		return {
			success: false,
			error: {
				message: formatError(error, 'Invalid JSON'),
				code: 'INVALID_JSON',
				...position,
				cause: error,
			},
			format: 'json',
		};
	}
}

/**
 * Strips comments from JSONC content
 * Handles line comments (//) and block comments
 */
function stripJSONComments(content: string): string {
	let result = '';
	let i = 0;
	let inString = false;
	let stringChar = '';

	while (i < content.length) {
		const char = content[i];
		const nextChar = content[i + 1];

		// Handle string state
		if (inString) {
			result += char;
			if (char === '\\' && i + 1 < content.length) {
				// Escape sequence - include next char
				result += nextChar;
				i += 2;
				continue;
			}
			if (char === stringChar) {
				inString = false;
			}
			i++;
			continue;
		}

		// Check for string start
		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			result += char;
			i++;
			continue;
		}

		// Check for line comment
		if (char === '/' && nextChar === '/') {
			// Skip until end of line
			while (i < content.length && content[i] !== '\n') {
				i++;
			}
			continue;
		}

		// Check for block comment
		if (char === '/' && nextChar === '*') {
			i += 2;
			// Skip until */
			while (i < content.length - 1) {
				if (content[i] === '*' && content[i + 1] === '/') {
					i += 2;
					break;
				}
				i++;
			}
			continue;
		}

		result += char;
		i++;
	}

	return result;
}

/**
 * Parses JSONC (JSON with Comments) content
 */
function parseJSONC(content: string): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'jsonc');
	}

	try {
		// Strip comments and parse as JSON
		const stripped = stripJSONComments(trimmed);
		const data = JSON.parse(stripped);
		return createSuccess(data, 'json', 'jsonc');
	} catch (error) {
		const position = extractJSONErrorPosition(error);
		return {
			success: false,
			error: {
				message: formatError(error, 'Invalid JSONC'),
				code: 'INVALID_JSONC',
				...position,
				cause: error,
			},
			format: 'jsonc',
		};
	}
}

/**
 * Parses JSONL (JSON Lines / NDJSON) content
 * Each line is a separate JSON object, parsed into an array
 */
function parseJSONL(content: string): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'jsonl');
	}

	try {
		const lines = trimmed.split('\n').filter(line => line.trim().length > 0);
		const data: unknown[] = [];

		for (let i = 0; i < lines.length; i++) {
			try {
				const parsed = JSON.parse(lines[i].trim());
				data.push(parsed);
			} catch (lineError) {
				return {
					success: false,
					error: {
						message: `Invalid JSON on line ${i + 1}: ${formatError(lineError, 'Parse error')}`,
						code: 'INVALID_JSONL',
						line: i + 1,
						cause: lineError,
					},
					format: 'jsonl',
				};
			}
		}

		return createSuccess(data, 'json', 'jsonl');
	} catch (error) {
		return createFailure('INVALID_JSONL', formatError(error, 'Invalid JSONL'), 'jsonl', error);
	}
}

/**
 * Parses YAML content
 */
function parseYAML(content: string): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'yaml');
	}

	try {
		const data = YAML.parse(trimmed);
		return createSuccess(data, 'json', 'yaml');
	} catch (error) {
		return createFailure('INVALID_YAML', formatError(error, 'Invalid YAML'), 'yaml', error);
	}
}

/**
 * Parses XML content using fast-xml-parser (browser-compatible)
 */
function parseXMLContent(content: string, options?: XMLOptions): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'xml');
	}

	try {
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: options?.mergeAttrs === false ? '@_' : '',
			trimValues: options?.trim ?? true,
			parseAttributeValue: true,
			parseTagValue: true,
		});
		const data = parser.parse(trimmed);
		return createSuccess(data, 'json', 'xml');
	} catch (error) {
		return createFailure('INVALID_XML', formatError(error, 'Invalid XML'), 'xml', error);
	}
}

/**
 * Parses CSV content using PapaParse (browser-compatible)
 */
function parseCSVContent(content: string, options?: CSVOptions): ParseResult {
	const trimmed = content.trim();

	if (!trimmed) {
		return createFailure('EMPTY_CONTENT', 'Content is empty', 'csv');
	}

	try {
		const result = Papa.parse<Record<string, string>>(trimmed, {
			delimiter: options?.delimiter || '', // Empty string = auto-detect
			header: options?.hasHeaders ?? true,
			skipEmptyLines: options?.skipEmptyLines ?? true,
			transformHeader: options?.trimFields !== false ? (h) => h.trim() : undefined,
			transform: options?.trimFields !== false ? (value) => value.trim() : undefined,
		});

		if (result.errors.length > 0) {
			const firstError = result.errors[0];
			return createFailure(
				'INVALID_CSV',
				`CSV parse error at row ${firstError.row}: ${firstError.message}`,
				'csv',
				result.errors
			);
		}

		return createSuccess(result.data, 'json', 'csv');
	} catch (error) {
		return createFailure('INVALID_CSV', formatError(error, 'Invalid CSV'), 'csv', error);
	}
}

// Main API

/**
 * File Import Processor
 * 
 * Provides a unified interface for parsing multiple file formats
 * and converting them to JSON.
 * 
 * @example
 * ```typescript
 * // Parse with auto-detection
 * const result = await FileImporter.parse(content);
 * if (result.success) {
 *   console.log(result.data);
 * }
 * 
 * // Parse with explicit format
 * const yamlResult = await FileImporter.parse(content, { format: 'yaml' });
 * 
 * // Parse CSV with custom options
 * const csvResult = await FileImporter.parse(content, {
 *   format: 'csv',
 *   csv: { delimiter: ';', hasHeaders: true }
 * });
 * ```
 */
export const FileImporter = {
	/**
	 * Parses content and converts to JSON
	 * 
	 * @param content - Raw file content as string
	 * @param options - Parsing options
	 * @returns Parse result with success status and data or error
	 */
	async parse(content: string, options?: ImportOptions): Promise<ParseResult> {
		// All parsers are now synchronous, but we keep async for API compatibility
		return this.parseSync(content, options);
	},

	/**
	 * Parses content synchronously
	 * All parsers are now synchronous (using browser-compatible libraries)
	 * 
	 * @param content - Raw file content as string
	 * @param options - Parsing options
	 * @returns Parse result with success status and data or error
	 */
	parseSync(content: string, options?: ImportOptions): ParseResult {
		const format = options?.format ?? detectFormat(content, options?.filename);

		switch (format) {
			case 'json':
				return parseJSON(content);

			case 'jsonc':
				return parseJSONC(content);

			case 'jsonl':
				return parseJSONL(content);

			case 'yaml':
				return parseYAML(content);
			
			case 'csv':
				return parseCSVContent(content, options?.csv);
			
			case 'xml':
				return parseXMLContent(content, options?.xml);
			
			case 'unknown': {
				// Try parsers in order of likelihood
				const jsonResult = parseJSON(content);
				if (jsonResult.success) return jsonResult;

				const jsonlResult = parseJSONL(content);
				if (jsonlResult.success) return jsonlResult;

				const yamlResult = parseYAML(content);
				if (yamlResult.success) return yamlResult;

				const csvResult = parseCSVContent(content, options?.csv);
				if (csvResult.success) return csvResult;

				const xmlResult = parseXMLContent(content, options?.xml);
				if (xmlResult.success) return xmlResult;

				return createFailure(
					'UNKNOWN_FORMAT',
					'Could not determine file format. Please ensure the content is valid JSON, JSONL, YAML, XML, or CSV.',
					'unknown'
				);
			}
		}
	},

	/**
	 * Converts parsed data to formatted JSON string
	 * 
	 * @param data - Any JavaScript value
	 * @param indent - Number of spaces for indentation (default: 2)
	 * @returns Formatted JSON string
	 */
	toJSON(data: unknown, indent: number = 2): string {
		return JSON.stringify(data, null, indent);
	},

	/**
	 * Validates content by attempting to parse it
	 * 
	 * @param content - Raw file content as string
	 * @param options - Parsing options
	 * @returns Validation result with format information
	 */
	async validate(content: string, options?: ImportOptions): Promise<{
		readonly isValid: boolean;
		readonly format: FileFormat;
		readonly error?: string;
	}> {
		const result = await this.parse(content, options);
		
		return {
			isValid: result.success,
			format: result.format,
			error: result.success ? undefined : result.error.message,
		};
	},

	/**
	 * Detects the format of content
	 * 
	 * @param content - Raw file content as string
	 * @param filename - Optional filename for extension-based detection
	 * @returns Detected file format
	 */
	detectFormat(content: string, filename?: string): FileFormat {
		return detectFormat(content, filename);
	},

	/**
	 * Gets supported file extensions
	 * 
	 * @returns Array of supported extensions
	 */
	getSupportedExtensions(): readonly string[] {
		return Object.keys(EXTENSION_MAP);
	},

	/**
	 * Gets supported formats
	 * 
	 * @returns Array of supported format names
	 */
	getSupportedFormats(): readonly FileFormat[] {
		return FILE_FORMATS.filter(f => f !== 'unknown');
	},
} as const;

/**
 * Default export for convenience
 */
export default FileImporter;
