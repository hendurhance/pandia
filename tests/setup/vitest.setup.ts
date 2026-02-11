import { beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { resetAllMocks } from '../mocks/tauri';
import { resetDialogMocks } from '../mocks/tauri-dialog';
import { resetFsMocks } from '../mocks/tauri-fs';
import { clearAllStores } from '../mocks/tauri-store';
import { resetHttpMocks } from '../mocks/tauri-http';
import { resetIndexedDB } from '../mocks/indexeddb';

// Global setup
beforeAll(() => {
	// Mock window.matchMedia
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}))
	});

	// Mock ResizeObserver
	global.ResizeObserver = vi.fn().mockImplementation(() => ({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	}));

	// Mock IntersectionObserver
	global.IntersectionObserver = vi.fn().mockImplementation(() => ({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn()
	}));

	// Mock clipboard API
	Object.defineProperty(navigator, 'clipboard', {
		value: {
			writeText: vi.fn().mockResolvedValue(undefined),
			readText: vi.fn().mockResolvedValue('')
		},
		writable: true
	});

	// Mock crypto.randomUUID
	if (!crypto.randomUUID) {
		Object.defineProperty(crypto, 'randomUUID', {
			value: () => {
				return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
					const r = (Math.random() * 16) | 0;
					const v = c === 'x' ? r : (r & 0x3) | 0x8;
					return v.toString(16);
				});
			}
		});
	}

	// Mock performance.now if needed
	if (typeof performance === 'undefined') {
		(global as unknown as { performance: { now: () => number } }).performance = {
			now: () => Date.now()
		};
	}
});

// Reset state before each test
beforeEach(() => {
	resetAllMocks();
	resetDialogMocks();
	resetFsMocks();
	clearAllStores();
	resetHttpMocks();
	resetIndexedDB();
	vi.clearAllTimers();
});

// Cleanup after each test
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});
