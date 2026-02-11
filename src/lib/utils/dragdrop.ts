import { tabs } from '$lib/stores/tabs';
import { BYTES } from '$lib/constants';
import { isValidFileType } from './validation';
import { formatError, type FileProgressCallback } from './error';

interface FileValidationResult {
	readonly isValid: boolean;
	readonly error?: string;
}

export interface DropHandler {
	readonly handleFileDrop: (event: DragEvent, progressCallback?: FileProgressCallback) => Promise<void>;
	readonly handleDragOver: (event: DragEvent) => void;
	readonly handleDragEnter: (event: DragEvent) => void;
	readonly handleDragLeave: (event: DragEvent) => void;
	readFileAsText(file: File): Promise<string>;
	readFileWithProgress(file: File, progressCallback?: (progress: number) => void): Promise<string>;
}

export const dragDrop: DropHandler = {
	handleDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	},

	handleDragEnter(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		
		const target = event.target as HTMLElement;
		target.classList?.add('drag-over');
	},

	handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
		
		const target = event.target as HTMLElement;
		target.classList?.remove('drag-over');
	},

	async handleFileDrop(event: DragEvent, progressCallback?: FileProgressCallback): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		
		const target = event.target as HTMLElement;
		target.classList?.remove('drag-over');

		if (!event.dataTransfer?.files) return;

		const files = Array.from(event.dataTransfer.files);
		
		for (const file of files) {
			if (!isValidFileType(file)) {
				throw new Error(`Unsupported file type: ${file.name}. Supported formats: JSON, TXT, YAML, XML, CSV`);
			}

			try {
				progressCallback?.(file.name, 0);

				const content = await this.readFileWithProgress(file, (progress) => {
					progressCallback?.(file.name, progress);
				});

				if (file.name.endsWith('.json')) {
					try {
						JSON.parse(content);
					} catch (error) {
						console.warn(`Invalid JSON in file ${file.name}:`, error);
					}
				}

				await tabs.add({
					title: file.name,
					content: content,
					isDirty: false,
					isNew: false
				});

				progressCallback?.(file.name, 100);
			} catch (error) {
				console.error(`Error reading file ${file.name}:`, error);
				throw new Error(`Failed to load ${file.name}: ${formatError(error)}`);
			}
		}
	},

	readFileAsText(file: File): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			
			reader.onload = (event) => {
				const result = event.target?.result;
				if (typeof result === 'string') {
					resolve(result);
				} else {
					reject(new Error('Failed to read file as text'));
				}
			};
			
			reader.onerror = () => {
				reject(new Error('File reading failed'));
			};
			
			reader.readAsText(file);
		});
	},

	async readFileWithProgress(file: File, progressCallback?: (progress: number) => void): Promise<string> {
		const CHUNK_SIZE = BYTES.MB;
		const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
		
		if (file.size < CHUNK_SIZE) {
			progressCallback?.(50);
			const content = await this.readFileAsText(file);
			progressCallback?.(100);
			return content;
		}

		let content = '';
		
		for (let i = 0; i < totalChunks; i++) {
			const start = i * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, file.size);
			const chunk = file.slice(start, end);
			
			const chunkText = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => resolve(e.target?.result as string ?? '');
				reader.onerror = () => reject(reader.error);
				reader.readAsText(chunk);
			});
			content += chunkText;
			
			const progress = Math.round(((i + 1) / totalChunks) * 100);
			progressCallback?.(progress);
			
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		
		return content;
	}
};