import { invoke } from '@tauri-apps/api/core';
import { BATCH_PROCESSING } from '$lib/constants';
import { JSONRepair } from './repair';
import { processBatch, type BatchResult } from '../utils/batch';
import type { ProgressCallback } from '../utils/error';

export interface JSONStats {
	readonly raw: number;
	readonly gzip: number;
	readonly brotli: number;
	readonly objects?: number;
	readonly arrays?: number;
	readonly keys?: number;
	readonly depth?: number;
	readonly lines?: number;
}

type SizeStats = Pick<JSONStats, 'raw' | 'gzip' | 'brotli'>;
type BatchValidationResult = BatchResult<boolean>;
type BatchProcessResult = BatchResult<string>;

export const jsonUtils = {
	async validate(content: string, _progressCallback?: ProgressCallback): Promise<boolean> {
		try {
			return await invoke<boolean>('validate_json', { content });
		} catch (error) {
			throw error;
		}
	},

	async format(content: string, indent?: number, _progressCallback?: ProgressCallback): Promise<string> {
		try {
			return await invoke<string>('format_json', { content, indent });
		} catch (error) {
			throw error;
		}
	},

	async compress(content: string, _progressCallback?: ProgressCallback): Promise<string> {
		try {
			return await invoke<string>('compress_json', { content });
		} catch (error) {
			throw error;
		}
	},

	async getStats(content: string): Promise<JSONStats> {
		try {
			const sizeStats = await invoke<SizeStats>('calculate_json_size', { content });
			const additionalStats = this.calculateAdditionalStats(content);
			
			return {
				...sizeStats,
				...additionalStats
			};
		} catch (error) {
			throw error;
		}
	},

	calculateAdditionalStats(content: string): Partial<JSONStats> {
		try {
			const parsed: unknown = JSON.parse(content);
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
					obj.forEach(item => {
						if (typeof item === 'object' && item !== null) {
							traverse(item, currentDepth + 1);
						}
					});
				} else if (typeof obj === 'object' && obj !== null) {
					stats.objects++;
					const keys = Object.keys(obj);
					stats.keys += keys.length;
					
					keys.forEach(key => {
						const value = (obj as Record<string, unknown>)[key];
						if (typeof value === 'object' && value !== null) {
							traverse(value, currentDepth + 1);
						}
					});
				}
			}

			traverse(parsed);
			return stats;
		} catch (error) {
			return {
				objects: 0,
				arrays: 0,
				keys: 0,
				depth: 0,
				lines: content.split('\n').length
			};
		}
	},

	async sortKeys(content: string, recursive = false): Promise<string> {
		try {
			const parsed: unknown = JSON.parse(content);
			const sorted = this.sortObjectKeys(parsed, recursive);
			return JSON.stringify(sorted, null, 2);
		} catch (error) {
			throw error;
		}
	},

	sortObjectKeys(obj: unknown, recursive: boolean): unknown {
		if (Array.isArray(obj)) {
			return recursive 
				? obj.map(item => this.sortObjectKeys(item, recursive))
				: obj;
		} else if (typeof obj === 'object' && obj !== null) {
			const sorted: Record<string, unknown> = {};
			Object.keys(obj).sort().forEach(key => {
				const value = (obj as Record<string, unknown>)[key];
				sorted[key] = recursive 
					? this.sortObjectKeys(value, recursive)
					: value;
			});
			return sorted;
		}
		return obj;
	},

	async repairJson(content: string): Promise<string> {
		const result = JSONRepair.repair(content);
		if (!result.success) {
			throw new Error(`JSON repair failed: ${result.errors.join(', ')}`);
		}
		return result.repairedJSON;
	},

	async convertToYaml(content: string): Promise<string> {
		try {
			const parsed: unknown = JSON.parse(content);
			return this.jsonToYaml(parsed);
		} catch (error) {
			throw error;
		}
	},

	jsonToYaml(obj: unknown, indent = ''): string {
		let yaml = '';
		
		if (Array.isArray(obj)) {
			obj.forEach((item) => {
				yaml += `${indent}- `;
				if (typeof item === 'object' && item !== null) {
					yaml += '\n' + this.jsonToYaml(item, indent + '  ');
				} else {
					yaml += this.yamlValue(item) + '\n';
				}
			});
		} else if (typeof obj === 'object' && obj !== null) {
			Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
				yaml += `${indent}${key}: `;
				if (typeof value === 'object' && value !== null) {
					yaml += '\n' + this.jsonToYaml(value, indent + '  ');
				} else {
					yaml += this.yamlValue(value) + '\n';
				}
			});
		}
		
		return yaml;
	},

	yamlValue(value: unknown): string {
		if (typeof value === 'string') {
			// Escape backslashes and quotes in YAML strings
			const escaped = value
				.replace(/\\/g, '\\\\')
				.replace(/"/g, '\\"')
				.replace(/\n/g, '\\n')
				.replace(/\r/g, '\\r')
				.replace(/\t/g, '\\t');
			return `"${escaped}"`;
		}
		if (value === null) return 'null';
		if (value === undefined) return '~';
		return String(value);
	},

	async convertToXml(content: string): Promise<string> {
		try {
			const parsed: unknown = JSON.parse(content);
			return this.jsonToXml(parsed);
		} catch (error) {
			throw error;
		}
	},

	jsonToXml(obj: unknown, rootName = 'root'): string {
		let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}>`;

		// Escape XML special characters
		function escapeXml(str: string): string {
			return str
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&apos;');
		}

		function convertValue(value: unknown, key?: string): string {
			if (Array.isArray(value)) {
				return value.map(item =>
					key ? `<${key}>${convertValue(item)}</${key}>` : convertValue(item)
				).join('');
			} else if (typeof value === 'object' && value !== null) {
				return Object.entries(value as Record<string, unknown>).map(([k, v]) =>
					`<${k}>${convertValue(v)}</${k}>`
				).join('');
			} else if (value === null || value === undefined) {
				return '';
			} else {
				return escapeXml(String(value));
			}
		}

		xml += convertValue(obj);
		xml += `</${rootName}>`;
		return xml;
	},

	async batchValidate(contents: readonly string[]): Promise<BatchValidationResult> {
		return processBatch(
			[...contents],
			(content) => this.validate(content),
			BATCH_PROCESSING.VALIDATION
		);
	},

	async batchFormat(contents: readonly string[], indent = 2): Promise<BatchProcessResult> {
		return processBatch(
			[...contents],
			(content) => this.format(content, indent),
			BATCH_PROCESSING.DEFAULT_SIZE
		);
	},

	async batchCompress(contents: readonly string[]): Promise<BatchProcessResult> {
		return processBatch(
			[...contents],
			(content) => this.compress(content),
			BATCH_PROCESSING.DEFAULT_SIZE
		);
	},

	async batchRepairJson(contents: readonly string[]): Promise<BatchProcessResult> {
		// JSONRepair.repair is synchronous, wrap in async for consistency
		return processBatch(
			[...contents],
			async (content) => {
				const result = JSONRepair.repair(content);
				if (result.success) {
					return result.repairedJSON;
				}
				throw new Error(result.errors.join(', '));
			},
			BATCH_PROCESSING.DEFAULT_SIZE
		);
	},

	async convertToCsv(content: string): Promise<string> {
		try {
			const data: unknown = JSON.parse(content);

			if (Array.isArray(data)) {
				return this.arrayToCsv(data);
			} else if (typeof data === 'object' && data !== null) {
				return this.objectToCsv(data as Record<string, unknown>);
			} else {
				throw new Error('JSON must be an object or array to convert to CSV');
			}
		} catch (error) {
			throw error;
		}
	},

	arrayToCsv(arr: unknown[]): string {
		if (arr.length === 0) return '';

		// Get all unique keys from all objects
		const allKeys = new Set<string>();
		arr.forEach(item => {
			if (typeof item === 'object' && item !== null) {
				Object.keys(item).forEach(key => allKeys.add(key));
			}
		});

		const headers = Array.from(allKeys);
		const csvHeaders = headers.map(h => this.escapeCsvField(h)).join(',');

		const csvRows = arr.map(item => {
			if (typeof item === 'object' && item !== null) {
				return headers.map(header => {
					const value = (item as Record<string, unknown>)[header];
					return this.escapeCsvField(this.formatCsvValue(value));
				}).join(',');
			} else {
				return this.escapeCsvField(this.formatCsvValue(item));
			}
		});

		return [csvHeaders, ...csvRows].join('\n');
	},

	objectToCsv(obj: Record<string, unknown>): string {
		const rows: string[] = ['Key,Value'];

		Object.entries(obj).forEach(([key, value]) => {
			const csvRow = [
				this.escapeCsvField(key),
				this.escapeCsvField(this.formatCsvValue(value))
			].join(',');
			rows.push(csvRow);
		});

		return rows.join('\n');
	},

	formatCsvValue(value: unknown): string {
		if (value === null || value === undefined) {
			return '';
		} else if (typeof value === 'object') {
			return JSON.stringify(value);
		} else {
			return String(value);
		}
	},

	escapeCsvField(field: string): string {
		if (field.includes(',') || field.includes('"') || field.includes('\n')) {
			return `"${field.replace(/"/g, '""')}"`;
		}
		return field;
	}
};