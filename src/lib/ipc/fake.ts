import { vi, type Mock } from 'vitest';
import { commands, type Summary } from './bindings';

export const SMALL_TIER: Pick<Summary, 'tier' | 'capabilities'> = {
	tier: 'small',
	capabilities: {
		edit: true,
		export: true,
		exportConverted: true,
		validate: true,
		sortFilter: true,
		codeView: true,
		graph: true,
		compare: true,
		typegen: true,
		typegenSchema: true,
	},
};

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
