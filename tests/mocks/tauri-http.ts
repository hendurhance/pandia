import { vi } from 'vitest';

// Mock response data
interface MockResponse {
	status: number;
	data: unknown;
	headers?: Record<string, string>;
}

const mockResponses: Map<string, MockResponse> = new Map();

// Fetch function
export const fetch = vi.fn(async (url: string, options?: RequestInit) => {
	const mockResponse = mockResponses.get(url);

	if (mockResponse) {
		return {
			ok: mockResponse.status >= 200 && mockResponse.status < 300,
			status: mockResponse.status,
			headers: new Headers(mockResponse.headers || {}),
			json: async () => mockResponse.data,
			text: async () =>
				typeof mockResponse.data === 'string'
					? mockResponse.data
					: JSON.stringify(mockResponse.data),
			blob: async () => new Blob([JSON.stringify(mockResponse.data)]),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(mockResponse.data)).buffer
		};
	}

	// Default response for unmocked URLs
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		json: async () => ({}),
		text: async () => '',
		blob: async () => new Blob([]),
		arrayBuffer: async () => new ArrayBuffer(0)
	};
});

// Helper functions for tests
export function setMockResponse(url: string, response: MockResponse): void {
	mockResponses.set(url, response);
}

export function clearMockResponses(): void {
	mockResponses.clear();
}

export function resetHttpMocks(): void {
	mockResponses.clear();
	vi.clearAllMocks();
}

export default {
	fetch,
	setMockResponse,
	clearMockResponses,
	resetHttpMocks
};
