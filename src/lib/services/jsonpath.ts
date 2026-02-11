export interface JSONPathResult {
	path: string;
	value: unknown;
}

export interface JSONPathPattern {
	pattern: string;
	description: string;
}

const HISTORY_STORAGE_KEY = 'pandia-jsonpath-history';
const MAX_HISTORY_ITEMS = 10;

export const COMMON_PATTERNS: JSONPathPattern[] = [
	{ pattern: '$', description: 'Root element' },
	{ pattern: '$.key', description: 'Direct property access' },
	{ pattern: '$.*', description: 'All direct properties' },
	{ pattern: '$..key', description: 'Recursive search for key' },
	{ pattern: '$[0]', description: 'First array element' },
	{ pattern: '$[-1]', description: 'Last array element' },
	{ pattern: '$[0:3]', description: 'Array slice (first 3 elements)' },
	{ pattern: '$.*[?(@.key)]', description: 'Filter by property existence' }
];

class JSONPathService {
	private history: string[] = [];
	private historyLoaded = false;

	/**
	 * Validate JSONPath syntax
	 */
	validateSyntax(path: string): string | null {
		if (!path || path.trim() === '') {
			return 'Empty path';
		}

		let bracketCount = 0;
		let inQuotes = false;
		let quoteChar = '';

		for (let i = 0; i < path.length; i++) {
			const char = path[i];
			const prevChar = i > 0 ? path[i - 1] : '';

			if ((char === '"' || char === "'") && prevChar !== '\\') {
				if (!inQuotes) {
					inQuotes = true;
					quoteChar = char;
				} else if (char === quoteChar) {
					inQuotes = false;
					quoteChar = '';
				}
			}

			if (!inQuotes) {
				if (char === '[') {
					bracketCount++;
				} else if (char === ']') {
					bracketCount--;
					if (bracketCount < 0) {
						return 'Unmatched closing bracket ]';
					}
				}
			}
		}

		if (bracketCount > 0) {
			return 'Unmatched opening bracket [';
		}

		if (inQuotes) {
			return `Unmatched quote ${quoteChar}`;
		}

		const bracketMatches = path.match(/\[([^\]]*)\]/g);
		if (bracketMatches) {
			for (const match of bracketMatches) {
				const content = match.slice(1, -1);
				if (content === '') {
					return 'Empty bracket notation []';
				}

				const isNumber = /^-?\d+$/.test(content);
				const isSingleQuotedString = /^'([^'\\]|\\.)*'$/.test(content);
				const isDoubleQuotedString = /^"([^"\\]|\\.)*"$/.test(content);
				const isUnquotedIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(content);

				const isValid = isNumber || isSingleQuotedString || isDoubleQuotedString || isUnquotedIdentifier;

				if (!isValid) {
					return `Invalid bracket content: [${content}]`;
				}
			}
		}

		const dotParts = path.split(/[\[\]]/)[0].split('.');
		for (let i = 1; i < dotParts.length; i++) {
			const part = dotParts[i];
			if (part === '') {
				continue;
			}

			if (part !== '*' && part !== '**' && !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
				return `Invalid property name: ${part}`;
			}
		}

		return null;
	}

	/**
	 * Evaluate JSONPath expression against data
	 */
	evaluate(data: unknown, path: string): JSONPathResult[] {
		const results: JSONPathResult[] = [];

		if (path === '$' || path === '' || path.trim() === '') {
			results.push({ path: '$', value: data });
			return results;
		}

		const normalizedPath = path.trim();
		const cleanPath = normalizedPath.startsWith('$') ? normalizedPath.slice(1) : normalizedPath;

		try {
			if (cleanPath.startsWith('.')) {
				this.evaluateDotNotation(data, cleanPath, '$', results);
			} else if (cleanPath.startsWith('[')) {
				this.evaluateBracketNotation(data, cleanPath, '$', results);
			} else if (cleanPath === '') {
				results.push({ path: '$', value: data });
			} else {
				this.evaluateDotNotation(data, '.' + cleanPath, '$', results);
			}

			if (results.length === 0 && (cleanPath.includes('.') && cleanPath.includes('['))) {
				this.evaluateMixedNotation(data, cleanPath, '$', results);
			} else if (results.length === 0 && cleanPath.startsWith('[') && cleanPath.match(/\]\[/)) {
				this.evaluateMixedNotation(data, cleanPath, '$', results);
			}
		} catch (error) {
			throw new Error(`Invalid JSONPath syntax: ${path}`);
		}

		return results.filter(result => result.value !== undefined);
	}

	/**
	 * Execute a JSONPath query with validation
	 */
	query(data: unknown, path: string): { results: JSONPathResult[]; error: string | null } {
		const validationError = this.validateSyntax(path);
		if (validationError) {
			return { results: [], error: `JSONPath syntax error: ${validationError}` };
		}

		try {
			const results = this.evaluate(data, path);
			this.addToHistory(path);
			return { results, error: null };
		} catch (error) {
			return { results: [], error: `JSONPath error: ${error}` };
		}
	}

	/**
	 * Get query history
	 */
	getHistory(): string[] {
		if (!this.historyLoaded) {
			this.loadHistory();
		}
		return [...this.history];
	}

	/**
	 * Add query to history
	 */
	addToHistory(query: string): void {
		if (!query || this.history.includes(query)) return;

		this.history = [query, ...this.history.slice(0, MAX_HISTORY_ITEMS - 1)];
		this.saveHistory();
	}

	/**
	 * Clear query history
	 */
	clearHistory(): void {
		this.history = [];
		localStorage.removeItem(HISTORY_STORAGE_KEY);
	}

	/**
	 * Format a value for display
	 */
	formatValue(value: unknown): string {
		if (value === null) return 'null';
		if (value === undefined) return 'undefined';
		if (typeof value === 'string') return `"${value}"`;
		if (typeof value === 'object') {
			return Array.isArray(value) ? `Array(${value.length})` : 'Object';
		}
		return String(value);
	}

	/**
	 * Get a preview of a value (truncated for large objects)
	 */
	getValuePreview(value: unknown, maxLength = 200): string {
		if (value === null || value === undefined) return String(value);
		if (typeof value === 'object') {
			const json = JSON.stringify(value, null, 2);
			return json.length > maxLength ? json.substring(0, maxLength) + '...' : json;
		}
		return String(value);
	}

	private loadHistory(): void {
		const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
		if (saved) {
			try {
				this.history = JSON.parse(saved);
			} catch {
				this.history = [];
			}
		}
		this.historyLoaded = true;
	}

	private saveHistory(): void {
		localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(this.history));
	}

	private evaluateDotNotation(
		data: unknown,
		path: string,
		currentPath: string,
		results: JSONPathResult[]
	): void {
		if (!path || path === '.') {
			results.push({ path: currentPath, value: data });
			return;
		}

		const parts = path.substring(1).split('.').filter(part => part !== '');
		let current = data;
		let pathSoFar = currentPath;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];

			if (current === null || current === undefined) {
				return;
			}

			if (part === '*') {
				if (Array.isArray(current)) {
					current.forEach((item, index) => {
						const newPath = `${pathSoFar}[${index}]`;
						if (i === parts.length - 1) {
							results.push({ path: newPath, value: item });
						} else {
							const remainingPath = '.' + parts.slice(i + 1).join('.');
							this.evaluateDotNotation(item, remainingPath, newPath, results);
						}
					});
				} else if (typeof current === 'object') {
					Object.keys(current as object).forEach(key => {
						const newPath = `${pathSoFar}.${key}`;
						const val = (current as Record<string, unknown>)[key];
						if (i === parts.length - 1) {
							results.push({ path: newPath, value: val });
						} else {
							const remainingPath = '.' + parts.slice(i + 1).join('.');
							this.evaluateDotNotation(val, remainingPath, newPath, results);
						}
					});
				}
				return;
			}

			if (part === '**') {
				this.findRecursive(current, parts.slice(i + 1), pathSoFar, results);
				return;
			}

			if (part.includes('[') && part.includes(']')) {
				const keyMatch = part.match(/^([^[]+)\[(.+)\]$/);
				if (keyMatch) {
					const [, key, indexStr] = keyMatch;

					if (typeof current === 'object' && current !== null && key in current) {
						current = (current as Record<string, unknown>)[key];
						pathSoFar += `.${key}`;

						if (current !== null && current !== undefined) {
							const index = parseInt(indexStr.replace(/['"]/g, ''), 10);
							if (!isNaN(index) && Array.isArray(current) && index >= 0 && index < current.length) {
								current = current[index];
								pathSoFar += `[${index}]`;
							} else {
								const cleanIndex = indexStr.replace(/['"]/g, '');
								if (typeof current === 'object' && current !== null && cleanIndex in current) {
									current = (current as Record<string, unknown>)[cleanIndex];
									pathSoFar += `["${cleanIndex}"]`;
								} else {
									return;
								}
							}
						} else {
							return;
						}
					} else {
						return;
					}
				} else {
					return;
				}
			} else {
				if (typeof current === 'object' && current !== null && part in current) {
					current = (current as Record<string, unknown>)[part];
					pathSoFar += `.${part}`;
				} else {
					return;
				}
			}
		}

		if (current !== undefined) {
			results.push({ path: pathSoFar, value: current });
		}
	}

	private evaluateBracketNotation(
		data: unknown,
		path: string,
		currentPath: string,
		results: JSONPathResult[]
	): void {
		const bracketMatch = path.match(/^\[([^\]]+)\](.*)$/);
		if (bracketMatch) {
			const [, indexStr, remainder] = bracketMatch;
			let index: string | number = indexStr.replace(/^['"]|['"]$/g, '');

			const numIndex = parseInt(index as string, 10);
			if (!isNaN(numIndex)) {
				index = numIndex;
			}

			let newPath = currentPath;
			let newData = data;

			if (data === null || data === undefined) {
				return;
			}

			if (Array.isArray(data) && typeof index === 'number') {
				if (index >= 0 && index < data.length) {
					newData = data[index];
					newPath += `[${index}]`;
				} else {
					return;
				}
			} else if (typeof data === 'object' && data !== null) {
				newData = (data as Record<string, unknown>)[index as string];
				newPath += `["${index}"]`;
			} else {
				return;
			}

			if (remainder) {
				if (remainder.startsWith('.')) {
					this.evaluateDotNotation(newData, remainder, newPath, results);
				} else if (remainder.startsWith('[')) {
					this.evaluateBracketNotation(newData, remainder, newPath, results);
				} else {
					this.evaluateDotNotation(newData, '.' + remainder, newPath, results);
				}
			} else if (newData !== undefined) {
				results.push({ path: newPath, value: newData });
			}
		}
	}

	private evaluateMixedNotation(
		data: unknown,
		path: string,
		currentPath: string,
		results: JSONPathResult[]
	): void {
		let current = data;
		let pathSoFar = currentPath;
		let remainingPath = path;

		while (remainingPath.length > 0) {
			if (current === null || current === undefined) {
				return;
			}

			if (remainingPath.startsWith('.')) {
				const nextBracket = remainingPath.indexOf('[', 1);
				const segmentEnd = nextBracket === -1 ? remainingPath.length : nextBracket;
				const segment = remainingPath.substring(0, segmentEnd);

				const tempResults: JSONPathResult[] = [];
				this.evaluateDotNotation(current, segment, pathSoFar, tempResults);

				if (tempResults.length > 0) {
					current = tempResults[0].value;
					pathSoFar = tempResults[0].path;
					remainingPath = remainingPath.substring(segmentEnd);
				} else {
					return;
				}
			} else if (remainingPath.startsWith('[')) {
				const closingBracket = remainingPath.indexOf(']');
				if (closingBracket === -1) {
					return;
				}

				const segment = remainingPath.substring(0, closingBracket + 1);
				const tempResults: JSONPathResult[] = [];
				this.evaluateBracketNotation(current, segment, pathSoFar, tempResults);

				if (tempResults.length > 0) {
					current = tempResults[0].value;
					pathSoFar = tempResults[0].path;
					remainingPath = remainingPath.substring(closingBracket + 1);
				} else {
					return;
				}
			} else {
				const tempResults: JSONPathResult[] = [];
				this.evaluateDotNotation(current, '.' + remainingPath, pathSoFar, tempResults);

				if (tempResults.length > 0) {
					results.push(...tempResults);
				}
				return;
			}
		}

		if (current !== undefined) {
			results.push({ path: pathSoFar, value: current });
		}
	}

	private findRecursive(
		data: unknown,
		remainingParts: string[],
		currentPath: string,
		results: JSONPathResult[]
	): void {
		const recurse = (obj: unknown, path: string): void => {
			if (obj === null || obj === undefined) return;

			if (remainingParts.length === 0) {
				results.push({ path, value: obj });
				return;
			}

			const targetKey = remainingParts[0];

			if (typeof obj === 'object') {
				if (Array.isArray(obj)) {
					obj.forEach((item, index) => {
						const newPath = `${path}[${index}]`;
						if (targetKey === '*' || index.toString() === targetKey) {
							if (remainingParts.length === 1) {
								results.push({ path: newPath, value: item });
							} else {
								this.evaluateDotNotation(item, '.' + remainingParts.slice(1).join('.'), newPath, results);
							}
						}
						recurse(item, newPath);
					});
				} else {
					Object.keys(obj).forEach(key => {
						const newPath = path === '$' ? `$.${key}` : `${path}.${key}`;
						const val = (obj as Record<string, unknown>)[key];
						if (targetKey === '*' || key === targetKey) {
							if (remainingParts.length === 1) {
								results.push({ path: newPath, value: val });
							} else {
								this.evaluateDotNotation(val, '.' + remainingParts.slice(1).join('.'), newPath, results);
							}
						}
						recurse(val, newPath);
					});
				}
			}
		};

		recurse(data, currentPath);
	}
}

export const jsonPathService = new JSONPathService();
