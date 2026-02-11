import { vi } from 'vitest';

// Mock store data
const mockStoreData: Map<string, Map<string, unknown>> = new Map();

// Get or create a store
function getStore(name: string): Map<string, unknown> {
	if (!mockStoreData.has(name)) {
		mockStoreData.set(name, new Map());
	}
	return mockStoreData.get(name)!;
}

// Store class mock
export class Store {
	private name: string;

	constructor(name: string) {
		this.name = name;
	}

	async get<T>(key: string): Promise<T | undefined> {
		const store = getStore(this.name);
		return store.get(key) as T | undefined;
	}

	async set(key: string, value: unknown): Promise<void> {
		const store = getStore(this.name);
		store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		const store = getStore(this.name);
		store.delete(key);
	}

	async clear(): Promise<void> {
		const store = getStore(this.name);
		store.clear();
	}

	async keys(): Promise<string[]> {
		const store = getStore(this.name);
		return Array.from(store.keys());
	}

	async values(): Promise<unknown[]> {
		const store = getStore(this.name);
		return Array.from(store.values());
	}

	async entries(): Promise<[string, unknown][]> {
		const store = getStore(this.name);
		return Array.from(store.entries());
	}

	async save(): Promise<void> {
		// No-op for mock
	}

	async load(): Promise<void> {
		// No-op for mock
	}
}

// Load function
export const load = vi.fn(async (name: string) => {
	return new Store(name);
});

// Helper functions for tests
export function clearAllStores(): void {
	mockStoreData.clear();
}

export function setStoreValue(storeName: string, key: string, value: unknown): void {
	const store = getStore(storeName);
	store.set(key, value);
}

export function getStoreValue(storeName: string, key: string): unknown {
	const store = getStore(storeName);
	return store.get(key);
}

export default {
	Store,
	load,
	clearAllStores,
	setStoreValue,
	getStoreValue
};
