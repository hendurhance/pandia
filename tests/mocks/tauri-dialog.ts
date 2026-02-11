import { vi } from 'vitest';

// Mock dialog responses
let mockOpenResponse: string | string[] | null = null;
let mockSaveResponse: string | null = null;

// Open file dialog
export const open = vi.fn(async () => {
	return mockOpenResponse;
});

// Save file dialog
export const save = vi.fn(async () => {
	return mockSaveResponse;
});

// Message dialog
export const message = vi.fn(async () => {
	return;
});

// Confirm dialog
export const confirm = vi.fn(async () => {
	return true;
});

// Ask dialog
export const ask = vi.fn(async () => {
	return true;
});

// Helper functions for tests
export function setMockOpenResponse(response: string | string[] | null): void {
	mockOpenResponse = response;
}

export function setMockSaveResponse(response: string | null): void {
	mockSaveResponse = response;
}

export function resetDialogMocks(): void {
	mockOpenResponse = null;
	mockSaveResponse = null;
	vi.clearAllMocks();
}

export default {
	open,
	save,
	message,
	confirm,
	ask,
	setMockOpenResponse,
	setMockSaveResponse,
	resetDialogMocks
};
