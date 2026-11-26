import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	Channel: class {
		constructor(public onmessage: (message: unknown) => void = () => {}) {}
	},
}));
