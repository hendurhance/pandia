import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// Reset IndexedDB between tests
export function resetIndexedDB(): void {
	const indexedDB = new IDBFactory();
	globalThis.indexedDB = indexedDB;
}

export default {
	resetIndexedDB
};
