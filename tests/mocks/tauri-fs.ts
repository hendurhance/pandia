import { vi } from 'vitest';

// Mock file system state
const mockFileSystem: Map<string, string> = new Map();

// Read text file
export const readTextFile = vi.fn(async (path: string) => {
	const content = mockFileSystem.get(path);
	if (content === undefined) {
		throw new Error(`File not found: ${path}`);
	}
	return content;
});

// Write text file
export const writeTextFile = vi.fn(async (path: string, content: string) => {
	mockFileSystem.set(path, content);
});

// Read file
export const readFile = vi.fn(async (path: string) => {
	const content = mockFileSystem.get(path);
	if (content === undefined) {
		throw new Error(`File not found: ${path}`);
	}
	return new TextEncoder().encode(content);
});

// Write file
export const writeFile = vi.fn(async (path: string, content: Uint8Array) => {
	mockFileSystem.set(path, new TextDecoder().decode(content));
});

// Check if file exists
export const exists = vi.fn(async (path: string) => {
	return mockFileSystem.has(path);
});

// Remove file
export const remove = vi.fn(async (path: string) => {
	mockFileSystem.delete(path);
});

// Create directory
export const mkdir = vi.fn(async () => {
	// No-op for mock
});

// Read directory
export const readDir = vi.fn(async () => {
	return [];
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

export function resetFsMocks(): void {
	mockFileSystem.clear();
	vi.clearAllMocks();
}

export default {
	readTextFile,
	writeTextFile,
	readFile,
	writeFile,
	exists,
	remove,
	mkdir,
	readDir,
	setMockFile,
	clearMockFiles,
	getMockFile,
	resetFsMocks
};
