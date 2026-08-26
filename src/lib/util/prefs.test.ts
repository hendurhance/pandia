import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPersisted, savePersisted } from './persist';
import { definePrefs, boolField, intField, enumField } from './prefs.svelte';

vi.mock('./persist', () => ({
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

function makeStore() {
	return definePrefs({
		file: 'settings.json',
		key: 'test',
		schema: {
			debounceMs: intField(500, -1, 5000),
			enabled: boolField(true),
			tab: enumField<'a' | 'b' | 'c'>('a', ['a', 'b', 'c']),
		},
		normalize: (v) => (v.enabled ? v : { ...v, tab: 'a' as const }),
	});
}

describe('definePrefs', () => {
	beforeEach(() => {
		vi.mocked(loadPersisted).mockReset().mockResolvedValue(undefined);
		vi.mocked(savePersisted).mockReset().mockResolvedValue(undefined);
	});

	it('starts at schema defaults and loads sanitized persisted values', async () => {
		const store = makeStore();
		expect(store.debounceMs).toBe(500);
		expect(store.enabled).toBe(true);

		vi.mocked(loadPersisted).mockResolvedValue({
			debounceMs: 99_999, // above max
			enabled: 'yes', // wrong type
			tab: 'b',
		});
		await store.init();
		expect(store.debounceMs).toBe(5000); // clamped
		expect(store.enabled).toBe(true); // default kept
		expect(store.tab).toBe('b');
		expect(store.loaded).toBe(true);
	});

	it('set clamps through the same coercion as load — the clamp exists once', async () => {
		const store = makeStore();
		await store.set('debounceMs', 123_456);
		expect(store.debounceMs).toBe(5000);
		expect(savePersisted).toHaveBeenCalledTimes(1);
		expect(savePersisted).toHaveBeenCalledWith(
			'settings.json',
			'test',
			expect.objectContaining({ debounceMs: 5000 }),
		);
	});

	it('a no-op set does not persist', async () => {
		const store = makeStore();
		await store.set('enabled', true);
		expect(savePersisted).not.toHaveBeenCalled();
	});

	it('update batches fields and applies cross-field invariants', async () => {
		const store = makeStore();
		await store.update({ enabled: false, tab: 'c' });
		expect(store.enabled).toBe(false);
		expect(store.tab).toBe('a'); // normalize forced the tab
		expect(savePersisted).toHaveBeenCalledTimes(1);
	});

	it('stage assigns without persisting; persistNow commits', async () => {
		const store = makeStore();
		expect(store.stage({ debounceMs: 900 })).toBe(true);
		expect(store.debounceMs).toBe(900);
		expect(savePersisted).not.toHaveBeenCalled();
		expect(store.stage({ debounceMs: 900 })).toBe(false);
		await store.persistNow();
		expect(savePersisted).toHaveBeenCalledTimes(1);
	});
});
