import { describe, expect, it, vi } from 'vitest';
import { commandRegistry, commandUsage, type Command } from './command-store.svelte';

vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	savePersisted: vi.fn(async () => {}),
}));

function cmd(id: string): Command {
	return { id, label: id, category: 'Tab', run: () => {} };
}

describe('CommandRegistry', () => {
	it('unregister removes exactly the registered command', () => {
		const a = commandRegistry.register(cmd('t.a'));
		const b = commandRegistry.register(cmd('t.b'));
		expect(commandRegistry.list.map((c) => c.id)).toEqual(['t.a', 't.b']);
		a();
		expect(commandRegistry.list.map((c) => c.id)).toEqual(['t.b']);
		b();
		expect(commandRegistry.list).toEqual([]);
	});

	it('stale unregister leaves a same-id replacement in place', () => {
		const stale = commandRegistry.register(cmd('t.dup'));
		const fresh = commandRegistry.register(cmd('t.dup'));
		stale();
		expect(commandRegistry.list.map((c) => c.id)).toEqual(['t.dup']);
		fresh();
		expect(commandRegistry.list).toEqual([]);
	});
});

describe('Recently used commands', () => {
	it('lists the last used command first, however often the others ran', () => {
		for (let i = 0; i < 3; i++) commandUsage.bump('t.often');
		commandUsage.bump('t.once');
		expect(commandUsage.topN(5, ['t.often', 't.once'])).toEqual(['t.once', 't.often']);
	});
});
