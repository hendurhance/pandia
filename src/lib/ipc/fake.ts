import { vi, type Mock } from 'vitest';
import { commands } from './bindings';

type Commands = typeof commands;

export type FakeIpc = { [K in keyof Commands]: Mock<Commands[K]> };

type Overrides = { [K in keyof Commands]?: (...args: Parameters<Commands[K]>) => unknown };

export function fakeIpc(overrides: Overrides = {}): FakeIpc {
	const fake: Record<string, Mock> = {};
	for (const name of Object.keys(commands) as (keyof Commands)[]) {
		const given = overrides[name];
		fake[name] = vi.isMockFunction(given)
			? (given as Mock)
			: vi.fn(given ?? (async () => undefined));
	}
	return fake as unknown as FakeIpc;
}
