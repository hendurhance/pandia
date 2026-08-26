import { describe, expect, it } from 'vitest';
import { commandRegistry, type Command } from './command-store.svelte';

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
