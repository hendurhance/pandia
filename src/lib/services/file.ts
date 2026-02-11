import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { documentDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { FILE_LIMITS, FILE_EXTENSIONS, BATCH_PROCESSING } from '$lib/constants';
import {
	validatePathSecurity,
	validateFileExtension,
	validateFileSize,
	extractFileName
} from '../utils/validation';
import { formatError, type ProgressCallback } from '../utils/error';
import { processBatch, processBatchWithContext, type BatchResultWithContext } from '../utils/batch';

export interface FileResult {
	readonly name: string;
	readonly path: string;
	readonly content: string;
}

export interface SaveResult {
	readonly name: string;
	readonly path: string;
}

export interface FileError {
	readonly path: string;
	readonly error: string;
}

type BatchResult<T> = BatchResultWithContext<T, FileError>;

export const fileOperations = {
	async openFile(): Promise<FileResult | null> {
		try {
			const selected = await open({
				multiple: false,
				defaultPath: await documentDir(),
				filters: [
					{
						name: 'JSON Files',
						extensions: ['json']
					},
					{
						name: 'Text Files',
						extensions: ['txt', 'md', 'log']
					}
				]
			});

			if (selected && typeof selected === 'string') {
				return await this.processFile(selected);
			}
			
			return null;
		} catch (error) {
			console.error('Error opening file:', error);
			throw error;
		}
	},

	async openMultipleFiles(): Promise<FileResult[]> {
		try {
			const selected = await open({
				multiple: true,
				defaultPath: await documentDir(),
				filters: [
					{
						name: 'JSON Files',
						extensions: ['json']
					},
					{
						name: 'Text Files',
						extensions: ['txt', 'md', 'log']
					}
				]
			});

			if (selected && Array.isArray(selected)) {
				const { results, errors } = await processBatch(
					selected,
					(filePath) => this.processFile(filePath),
					BATCH_PROCESSING.DEFAULT_SIZE
				);

				// Log any errors
				errors.forEach((error, index) => {
					if (error) {
						console.error(`Failed to process file ${selected[index]}:`, error);
					}
				});

				// Filter out null results (failed files)
				return results.filter((result): result is FileResult => result !== null);
			}

			return [];
		} catch (error) {
			console.error('Error opening multiple files:', error);
			throw error;
		}
	},

	async processFile(filePath: string, progressCallback?: ProgressCallback): Promise<FileResult> {
		validatePathSecurity(filePath);
		validateFileExtension(filePath, FILE_EXTENSIONS.ALLOWED);

		const content = await readTextFile(filePath);
		validateFileSize(content, FILE_LIMITS.MAX_FILE_SIZE);

		return {
			name: extractFileName(filePath),
			path: filePath,
			content
		};
	},

	async batchProcessFiles(
		filePaths: readonly string[],
		operation: (content: string) => string
	): Promise<BatchResult<FileResult>> {
		return processBatchWithContext(
			filePaths,
			async (filePath) => {
				const fileResult = await this.processFile(filePath);
				return {
					...fileResult,
					content: operation(fileResult.content)
				};
			},
			(filePath, error) => ({ path: filePath, error: formatError(error) }),
			BATCH_PROCESSING.FILE_PROCESSING
		);
	},

	async saveBatchFiles(
		files: ReadonlyArray<{ readonly path: string; readonly content: string }>
	): Promise<BatchResult<string>> {
		return processBatchWithContext(
			files,
			async (file) => {
				await this.saveFile(file.path, file.content);
				return file.path;
			},
			(file, error) => ({ path: file.path, error: formatError(error) }),
			BATCH_PROCESSING.DEFAULT_SIZE
		);
	},

	async saveFile(path: string, content: string): Promise<void> {
		try {
			await writeTextFile(path, content);
		} catch (error) {
			console.error('Error saving file:', error);
			throw error;
		}
	},

	async saveFileAs(content: string, defaultFileName?: string): Promise<SaveResult | null> {
		try {
			validateFileSize(content, FILE_LIMITS.LEGACY_MAX_SIZE);

			const docDir = await documentDir();
			const defaultPath = defaultFileName
				? `${docDir}/${defaultFileName}`
				: `${docDir}/untitled.json`;

			const selected = await save({
				filters: [
					{ name: 'JSON Files', extensions: ['json'] },
					{ name: 'YAML Files', extensions: ['yaml', 'yml'] },
					{ name: 'XML Files', extensions: ['xml'] },
					{ name: 'CSV Files', extensions: ['csv'] },
					{ name: 'Text Files', extensions: ['txt'] },
					{ name: 'All Files', extensions: ['*'] }
				],
				defaultPath
			});

			if (selected) {
				validatePathSecurity(selected);
				validateFileExtension(selected, FILE_EXTENSIONS.EXPORT);

				await this.saveFile(selected, content);

				return {
					name: extractFileName(selected),
					path: selected
				};
			}

			return null;
		} catch (error) {
			console.error('Error saving file as:', error);
			throw error;
		}
	},

	async readFileContent(path: string): Promise<string> {
		try {
			if (!path || typeof path !== 'string') {
				throw new Error('Invalid file path provided');
			}

			validateFileExtension(path, FILE_EXTENSIONS.ALLOWED);

			const content = await invoke<string>('read_file_content', { path });
			validateFileSize(content, FILE_LIMITS.LEGACY_MAX_SIZE);

			return content;
		} catch (error) {
			console.error('Error reading file content:', error);
			throw new Error(`Failed to read file: ${formatError(error)}`);
		}
	},

	async writeFileContent(path: string, content: string): Promise<void> {
		try {
			if (!path || typeof path !== 'string') {
				throw new Error('Invalid file path provided');
			}
			if (typeof content !== 'string') {
				throw new Error('Content must be a string');
			}

			validateFileExtension(path, FILE_EXTENSIONS.EXPORT);
			validateFileSize(content, FILE_LIMITS.LEGACY_MAX_SIZE);

			await invoke('write_file_content', { path, content });
		} catch (error) {
			console.error('Error writing file content:', error);
			throw new Error(`Failed to write file: ${formatError(error)}`);
		}
	}
};