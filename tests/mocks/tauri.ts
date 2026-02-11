import { vi } from 'vitest';

// Mock file system state
const mockFileSystem: Map<string, string> = new Map();

// Mock Tauri invoke
export const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
	switch (command) {
		case 'read_file_content': {
			const content = mockFileSystem.get(args?.path as string);
			if (content === undefined) {
				throw new Error('File not found');
			}
			return content;
		}

		case 'write_file_content':
			mockFileSystem.set(args?.path as string, args?.content as string);
			return;

		case 'validate_json':
			try {
				JSON.parse(args?.content as string);
				return true;
			} catch {
				throw new Error('Invalid JSON');
			}

		case 'format_json': {
			const parsed = JSON.parse(args?.content as string);
			const indent = (args?.indent as number) || 2;
			return JSON.stringify(parsed, null, indent);
		}

		case 'compress_json':
			return JSON.stringify(JSON.parse(args?.content as string));

		case 'calculate_json_size': {
			const raw = (args?.content as string).length;
			return {
				raw,
				gzip: Math.floor(raw * 0.7),
				brotli: Math.floor(raw * 0.6)
			};
		}

		case 'get_pending_files':
			return [];

		case 'update_recent_files_menu':
			return;

		default:
			throw new Error(`Unknown command: ${command}`);
	}
});

// Helper functions for tests
export function setMockFile(path: string, content: string): void {
	mockFileSystem.set(path, content);
}

export function clearMockFiles(): void {
	mockFileSystem.clear();
}

export function getMockFile(path: string): string | undefined {
	return mockFileSystem.get(path);
}

// Reset all mocks
export function resetAllMocks(): void {
	mockFileSystem.clear();
	vi.clearAllMocks();
}

// Re-export for convenience
export default {
	invoke,
	setMockFile,
	clearMockFiles,
	getMockFile,
	resetAllMocks
};
