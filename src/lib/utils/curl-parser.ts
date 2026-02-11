/**
 * cURL Command Parser
 *
 * Parses cURL commands into a structured format that can be used
 * to execute HTTP requests via fetch API.
 *
 * Supports common curl options:
 * - URL (with or without quotes)
 * - -X, --request: HTTP method
 * - -H, --header: Request headers
 * - -d, --data, --data-raw, --data-binary: Request body
 * - -u, --user: Basic authentication
 * - --json: JSON content type shorthand
 * - -A, --user-agent: User agent header
 * - -e, --referer: Referer header
 * - -b, --cookie: Cookie header
 * - --compressed: Accept encoding (ignored, fetch handles this)
 * - -k, --insecure: Skip SSL verification (ignored in browser)
 * - -L, --location: Follow redirects (fetch default behavior)
 *
 * @module utils/curl-parser
 */

import { formatError } from './error';
import { http } from './http';

/**
 * Parsed cURL request structure
 */
export interface ParsedCurlRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	auth?: {
		type: 'basic';
		username: string;
		password: string;
	};
}

/**
 * Parse result with success/error handling
 */
export type CurlParseResult =
	| { success: true; request: ParsedCurlRequest }
	| { success: false; error: string };

/**
 * Tokenize a curl command into individual arguments
 * Handles quoted strings, escaped characters, and line continuations
 */
function tokenize(command: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaped = false;

	// Normalize the command: remove line continuations and extra whitespace
	const normalized = command
		.replace(/\\\r?\n/g, ' ')  // Line continuations
		.replace(/\r?\n/g, ' ')    // Newlines without backslash
		.trim();

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === '\\' && !inSingleQuote) {
			escaped = true;
			continue;
		}

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			continue;
		}

		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}

		if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
			if (current) {
				tokens.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

/**
 * Parse a header string into key-value pair
 */
function parseHeader(header: string): [string, string] | null {
	const colonIndex = header.indexOf(':');
	if (colonIndex === -1) {
		return null;
	}

	const key = header.substring(0, colonIndex).trim();
	const value = header.substring(colonIndex + 1).trim();

	return [key, value];
}

/**
 * Check if a string looks like a URL
 */
function isUrl(str: string): boolean {
	return /^https?:\/\//i.test(str) ||
	       /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(str);
}

/**
 * Parse a cURL command string into a structured request object
 */
export function parseCurl(command: string): CurlParseResult {
	const trimmed = command.trim();

	// Basic validation
	if (!trimmed) {
		return { success: false, error: 'Empty command' };
	}

	// Remove 'curl' prefix if present (case insensitive)
	const withoutPrefix = trimmed.replace(/^curl\s+/i, '');

	if (!withoutPrefix) {
		return { success: false, error: 'No URL or options provided' };
	}

	const tokens = tokenize(withoutPrefix);

	if (tokens.length === 0) {
		return { success: false, error: 'Could not parse command' };
	}

	const request: ParsedCurlRequest = {
		url: '',
		method: 'GET',
		headers: {},
	};

	let i = 0;

	while (i < tokens.length) {
		const token = tokens[i];

		// URL detection (not starting with -)
		if (!token.startsWith('-') && !request.url) {
			// Check if it's a URL
			if (isUrl(token)) {
				request.url = token.startsWith('http') ? token : `https://${token}`;
			}
			i++;
			continue;
		}

		// Handle options
		switch (token) {
			case '-X':
			case '--request':
				i++;
				if (i < tokens.length) {
					request.method = tokens[i].toUpperCase();
				}
				break;

			case '-H':
			case '--header':
				i++;
				if (i < tokens.length) {
					const parsed = parseHeader(tokens[i]);
					if (parsed) {
						request.headers[parsed[0]] = parsed[1];
					}
				}
				break;

			case '-d':
			case '--data':
			case '--data-raw':
			case '--data-binary':
			case '--data-ascii':
				i++;
				if (i < tokens.length) {
					request.body = tokens[i];
					// If no explicit method, data implies POST
					if (request.method === 'GET') {
						request.method = 'POST';
					}
				}
				break;

			case '--json':
				i++;
				if (i < tokens.length) {
					request.body = tokens[i];
					request.headers['Content-Type'] = 'application/json';
					request.headers['Accept'] = 'application/json';
					if (request.method === 'GET') {
						request.method = 'POST';
					}
				}
				break;

			case '-u':
			case '--user':
				i++;
				if (i < tokens.length) {
					const [username, password = ''] = tokens[i].split(':');
					request.auth = {
						type: 'basic',
						username,
						password,
					};
				}
				break;

			case '-A':
			case '--user-agent':
				i++;
				if (i < tokens.length) {
					request.headers['User-Agent'] = tokens[i];
				}
				break;

			case '-e':
			case '--referer':
				i++;
				if (i < tokens.length) {
					request.headers['Referer'] = tokens[i];
				}
				break;

			case '-b':
			case '--cookie':
				i++;
				if (i < tokens.length) {
					request.headers['Cookie'] = tokens[i];
				}
				break;

			// Options we acknowledge but ignore (browser handles differently)
			case '-k':
			case '--insecure':
			case '-L':
			case '--location':
			case '--compressed':
			case '-s':
			case '--silent':
			case '-S':
			case '--show-error':
			case '-v':
			case '--verbose':
			case '-o':
			case '--output':
			case '-O':
			case '--remote-name':
			case '-i':
			case '--include':
				// Skip these, some have arguments we need to consume
				if (['-o', '--output'].includes(token)) {
					i++; // Skip the filename argument
				}
				break;

			default:
				// Check if it's a combined short option like -sS
				if (token.startsWith('-') && !token.startsWith('--') && token.length > 2) {
					// Skip combined short options like -sS, -kL
				} else if (token.startsWith('--')) {
					// Unknown long option, skip any potential value
					if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
						i++;
					}
				}
				// If not starting with -, could be the URL at the end
				else if (!token.startsWith('-') && !request.url && isUrl(token)) {
					request.url = token.startsWith('http') ? token : `https://${token}`;
				}
				break;
		}

		i++;
	}

	// Validation
	if (!request.url) {
		return { success: false, error: 'No URL found in curl command' };
	}

	// Add Authorization header for basic auth
	if (request.auth) {
		const credentials = btoa(`${request.auth.username}:${request.auth.password}`);
		request.headers['Authorization'] = `Basic ${credentials}`;
	}

	return { success: true, request };
}

/**
 * Execute a parsed curl request using Tauri HTTP
 */
export async function executeCurlRequest(
	request: ParsedCurlRequest
): Promise<{ success: true; data: string; contentType: string | null } | { success: false; error: string }> {
	try {
		const response = await http<string>(request.url, {
			method: request.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
			headers: request.headers,
			body: request.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
				? request.body
				: undefined,
		});

		if (!response.ok) {
			return {
				success: false,
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const contentType = response.headers.get('Content-Type');
		const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

		return { success: true, data, contentType };
	} catch (error) {
		return { success: false, error: formatError(error, 'Request failed') };
	}
}

/**
 * Format a parsed request for display (debugging/preview)
 */
export function formatParsedRequest(request: ParsedCurlRequest): string {
	const lines: string[] = [];

	lines.push(`${request.method} ${request.url}`);

	for (const [key, value] of Object.entries(request.headers)) {
		// Don't show Authorization header value
		if (key.toLowerCase() === 'authorization') {
			lines.push(`${key}: [hidden]`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}

	if (request.body) {
		lines.push('');
		lines.push('Body:');
		// Try to format JSON body
		try {
			const parsed = JSON.parse(request.body);
			lines.push(JSON.stringify(parsed, null, 2));
		} catch {
			lines.push(request.body);
		}
	}

	return lines.join('\n');
}
