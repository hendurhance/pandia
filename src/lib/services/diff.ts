import * as jsondiffpatch from 'jsondiffpatch';

export interface DiffLineInfo {
	line: number;
	type: 'added' | 'removed' | 'modified' | 'context';
	path?: string;
	charChanges?: { start: number; end: number }[];
}

export interface DiffStats {
	added: number;
	removed: number;
	modified: number;
}

export interface DiffResult {
	delta: jsondiffpatch.Delta | undefined;
	stats: DiffStats;
	leftLines: DiffLineInfo[];
	rightLines: DiffLineInfo[];
}

export interface UnifiedDiffResult {
	content: string;
	lines: DiffLineInfo[];
}

interface PathLineMap {
	[path: string]: { start: number; end: number };
}

// Create jsondiffpatch instance with optimal settings for JSON comparison
const diffpatcher = jsondiffpatch.create({
	objectHash: (obj: object): string => {
		const o = obj as Record<string, unknown>;
		if (typeof o.id === 'string') return o.id;
		if (typeof o.name === 'string') return o.name;
		return JSON.stringify(obj);
	},
	arrays: {
		detectMove: true,
		includeValueOnMove: false
	}
});

export const diffService = {
	/**
	 * Format JSON content with consistent indentation
	 */
	formatJSON(content: string): string {
		try {
			const parsed = JSON.parse(content);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return content;
		}
	},

	/**
	 * Calculate differences between two JSON strings
	 */
	calculateDiff(leftContent: string, rightContent: string): DiffResult {
		try {
			const leftFormatted = this.formatJSON(leftContent);
			const rightFormatted = this.formatJSON(rightContent);
			const leftJSON = JSON.parse(leftFormatted);
			const rightJSON = JSON.parse(rightFormatted);

			const delta = diffpatcher.diff(leftJSON, rightJSON);

			// Analyze delta and map to line numbers
			const { stats, leftLines, rightLines } = this.analyzeDelta(delta, leftFormatted, rightFormatted);

			return { delta, stats, leftLines, rightLines };
		} catch {
			return {
				delta: undefined,
				stats: { added: 0, removed: 0, modified: 0 },
				leftLines: [],
				rightLines: []
			};
		}
	},

	/**
	 * Generate unified diff content from two JSON strings
	 */
	generateUnifiedDiff(
		leftContent: string,
		rightContent: string,
		leftDiffLines: DiffLineInfo[],
		rightDiffLines: DiffLineInfo[]
	): UnifiedDiffResult {
		const leftFormatted = this.formatJSON(leftContent);
		const rightFormatted = this.formatJSON(rightContent);
		const leftLines = leftFormatted.split('\n');
		const rightLines = rightFormatted.split('\n');

		const unifiedLines: string[] = [];
		const diffInfos: DiffLineInfo[] = [];

		// Build sets of changed lines from our analysis
		const leftRemovedLines = new Set(leftDiffLines.filter((d) => d.type === 'removed').map((d) => d.line));
		const leftModifiedLines = new Set(leftDiffLines.filter((d) => d.type === 'modified').map((d) => d.line));
		const rightAddedLines = new Set(rightDiffLines.filter((d) => d.type === 'added').map((d) => d.line));
		const rightModifiedLines = new Set(rightDiffLines.filter((d) => d.type === 'modified').map((d) => d.line));

		// Merge the two files showing changes
		let leftIdx = 0;
		let rightIdx = 0;
		let outputLine = 0;

		while (leftIdx < leftLines.length || rightIdx < rightLines.length) {
			const leftLine = leftLines[leftIdx];
			const rightLine = rightLines[rightIdx];

			if (leftIdx >= leftLines.length) {
				// Only right lines remain - they're additions
				unifiedLines.push('+ ' + rightLine);
				diffInfos.push({ line: outputLine, type: 'added' });
				rightIdx++;
				outputLine++;
			} else if (rightIdx >= rightLines.length) {
				// Only left lines remain - they're removals
				unifiedLines.push('- ' + leftLine);
				diffInfos.push({ line: outputLine, type: 'removed' });
				leftIdx++;
				outputLine++;
			} else if (leftRemovedLines.has(leftIdx)) {
				// This left line was removed
				unifiedLines.push('- ' + leftLine);
				diffInfos.push({ line: outputLine, type: 'removed' });
				leftIdx++;
				outputLine++;
			} else if (rightAddedLines.has(rightIdx) && !rightModifiedLines.has(rightIdx)) {
				// This right line was added (and not a modification)
				unifiedLines.push('+ ' + rightLine);
				diffInfos.push({ line: outputLine, type: 'added' });
				rightIdx++;
				outputLine++;
			} else if (leftModifiedLines.has(leftIdx) && rightModifiedLines.has(rightIdx)) {
				// Both modified - show old then new
				unifiedLines.push('- ' + leftLine);
				diffInfos.push({ line: outputLine, type: 'removed' });
				outputLine++;
				unifiedLines.push('+ ' + rightLine);
				diffInfos.push({ line: outputLine, type: 'added' });
				outputLine++;
				leftIdx++;
				rightIdx++;
			} else if (leftLine === rightLine) {
				// Lines match - context line
				unifiedLines.push('  ' + leftLine);
				diffInfos.push({ line: outputLine, type: 'context' });
				leftIdx++;
				rightIdx++;
				outputLine++;
			} else {
				// Lines differ but weren't caught by jsondiffpatch - show both
				unifiedLines.push('- ' + leftLine);
				diffInfos.push({ line: outputLine, type: 'removed' });
				outputLine++;
				unifiedLines.push('+ ' + rightLine);
				diffInfos.push({ line: outputLine, type: 'added' });
				outputLine++;
				leftIdx++;
				rightIdx++;
			}
		}

		return {
			content: unifiedLines.join('\n'),
			lines: diffInfos
		};
	},

	/**
	 * Analyze jsondiffpatch delta and map changes to line numbers
	 */
	analyzeDelta(
		delta: jsondiffpatch.Delta | undefined,
		leftFormatted: string,
		rightFormatted: string
	): {
		stats: DiffStats;
		leftLines: DiffLineInfo[];
		rightLines: DiffLineInfo[];
	} {
		const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
		const leftLines: DiffLineInfo[] = [];
		const rightLines: DiffLineInfo[] = [];

		if (!delta) return { stats, leftLines, rightLines };

		const leftLineMap = this.buildPathToLineMap(leftFormatted);
		const rightLineMap = this.buildPathToLineMap(rightFormatted);

		const traverse = (obj: unknown, path: string = '') => {
			if (!obj || typeof obj !== 'object') return;

			for (const key of Object.keys(obj as Record<string, unknown>)) {
				const value = (obj as Record<string, unknown>)[key];
				// Handle array index notation from jsondiffpatch
				let currentPath: string;
				if (key.startsWith('_')) continue; // Skip internal markers

				if (path && /^\d+$/.test(key)) {
					// Array index
					currentPath = `${path}[${key}]`;
				} else {
					currentPath = path ? `${path}.${key}` : key;
				}

				if (Array.isArray(value)) {
					if (value.length === 1) {
						// Added
						stats.added++;
						const rightLoc = rightLineMap[currentPath] || this.findApproximateLine(rightFormatted, key, value[0]);
						if (rightLoc) {
							for (let i = rightLoc.start; i <= rightLoc.end; i++) {
								rightLines.push({ line: i, type: 'added', path: currentPath });
							}
						}
					} else if (value.length === 3 && value[1] === 0 && value[2] === 0) {
						// Removed
						stats.removed++;
						const leftLoc = leftLineMap[currentPath] || this.findApproximateLine(leftFormatted, key, value[0]);
						if (leftLoc) {
							for (let i = leftLoc.start; i <= leftLoc.end; i++) {
								leftLines.push({ line: i, type: 'removed', path: currentPath });
							}
						}
					} else if (value.length === 2) {
						// Modified
						stats.modified++;
						const leftLoc = leftLineMap[currentPath] || this.findApproximateLine(leftFormatted, key, value[0]);
						const rightLoc = rightLineMap[currentPath] || this.findApproximateLine(rightFormatted, key, value[1]);

						if (leftLoc) {
							for (let i = leftLoc.start; i <= leftLoc.end; i++) {
								leftLines.push({
									line: i,
									type: 'modified',
									path: currentPath,
									charChanges: this.findCharChanges(value[0], value[1])
								});
							}
						}
						if (rightLoc) {
							for (let i = rightLoc.start; i <= rightLoc.end; i++) {
								rightLines.push({
									line: i,
									type: 'modified',
									path: currentPath,
									charChanges: this.findCharChanges(value[0], value[1])
								});
							}
						}
					}
				} else if (typeof value === 'object' && value !== null) {
					traverse(value, currentPath);
				}
			}
		};

		traverse(delta);
		return { stats, leftLines, rightLines };
	},

	/**
	 * Build a map from JSON paths to line numbers
	 */
	buildPathToLineMap(formattedJson: string): PathLineMap {
		const lines = formattedJson.split('\n');
		const map: PathLineMap = {};
		const pathStack: { key: string; arrayIndex: number }[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// Match key-value pairs
			const keyMatch = trimmed.match(/^"([^"]+)":\s*/);
			if (keyMatch) {
				const key = keyMatch[1];
				const pathParts = pathStack.map((p) => (p.arrayIndex >= 0 ? `[${p.arrayIndex}]` : p.key));
				const currentPath = pathParts.length > 0 ? pathParts.join('.') + '.' + key : key;

				// Find the end line for this value
				let endLine = i;
				const valueStart = line.indexOf(':') + 1;
				const valueStr = line.substring(valueStart).trim();

				if (valueStr.startsWith('{') || valueStr.startsWith('[')) {
					// Need to find matching closing bracket
					endLine = this.findClosingBracket(lines, i, valueStr[0] === '{' ? '{' : '[');
				}

				map[currentPath] = { start: i, end: endLine };

				// Check if this opens an object or array
				if (valueStr.startsWith('{')) {
					pathStack.push({ key, arrayIndex: -1 });
				} else if (valueStr.startsWith('[')) {
					pathStack.push({ key, arrayIndex: -1 });
				}
			}

			// Track array indices
			if (trimmed === '{' && pathStack.length > 0) {
				const last = pathStack[pathStack.length - 1];
				if (last.arrayIndex === -1) {
					last.arrayIndex = 0;
				} else {
					last.arrayIndex++;
				}
				const pathParts = pathStack.map((p) => (p.arrayIndex >= 0 ? `${p.key}[${p.arrayIndex}]` : p.key));
				const currentPath = pathParts.join('.');
				map[currentPath] = { start: i, end: this.findClosingBracket(lines, i, '{') };
			}

			// Pop from stack on closing brackets
			if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
				if (trimmed === '},' || trimmed === '}' || trimmed === '],' || trimmed === ']') {
					// Only pop if it's a standalone closing bracket
					const openCount = (line.match(/[{[]/g) || []).length;
					const closeCount = (line.match(/[}\]]/g) || []).length;
					if (closeCount > openCount && pathStack.length > 0) {
						pathStack.pop();
					}
				}
			}
		}

		return map;
	},

	/**
	 * Find the line with the closing bracket matching an opening bracket
	 */
	findClosingBracket(lines: string[], startLine: number, openChar: string): number {
		const closeChar = openChar === '{' ? '}' : ']';
		let depth = 0;

		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			for (const char of line) {
				if (char === openChar) depth++;
				if (char === closeChar) {
					depth--;
					if (depth === 0) return i;
				}
			}
		}
		return startLine;
	},

	/**
	 * Find approximate line location for a key/value pair
	 */
	findApproximateLine(
		content: string,
		key: string,
		value: unknown
	): { start: number; end: number } | null {
		const lines = content.split('\n');
		const searchKey = `"${key}"`;
		const valueStr = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(searchKey)) {
				// Check if value is on same line or find extent
				if (lines[i].includes(valueStr) || lines[i].includes(': {') || lines[i].includes(': [')) {
					const endLine = lines[i].includes(': {')
						? this.findClosingBracket(lines, i, '{')
						: lines[i].includes(': [')
							? this.findClosingBracket(lines, i, '[')
							: i;
					return { start: i, end: endLine };
				}
				return { start: i, end: i };
			}
		}
		return null;
	},

	/**
	 * Find character-level changes between two values
	 */
	findCharChanges(oldVal: unknown, newVal: unknown): { start: number; end: number }[] {
		const oldStr = typeof oldVal === 'string' ? oldVal : JSON.stringify(oldVal);
		const newStr = typeof newVal === 'string' ? newVal : JSON.stringify(newVal);

		const changes: { start: number; end: number }[] = [];

		// Simple character diff - find first and last differing positions
		let start = 0;
		while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
			start++;
		}

		let oldEnd = oldStr.length - 1;
		let newEnd = newStr.length - 1;
		while (oldEnd > start && newEnd > start && oldStr[oldEnd] === newStr[newEnd]) {
			oldEnd--;
			newEnd--;
		}

		if (start <= oldEnd || start <= newEnd) {
			changes.push({ start, end: Math.max(oldEnd, newEnd) + 1 });
		}

		return changes;
	},

	/**
	 * Check if two JSON strings are semantically equal
	 */
	areEqual(leftContent: string, rightContent: string): boolean {
		try {
			const left = JSON.parse(leftContent);
			const right = JSON.parse(rightContent);
			const delta = diffpatcher.diff(left, right);
			return delta === undefined;
		} catch {
			return false;
		}
	}
};
