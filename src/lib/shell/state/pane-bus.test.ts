import { describe, it, expect, vi } from 'vitest';
import { PaneCommandBus, type PaneCommand } from './pane-bus';

describe('PaneCommandBus', () => {
	it('delivers a command only to the pane owning the tab', () => {
		const bus = new PaneCommandBus();
		const a = vi.fn();
		const b = vi.fn();
		bus.subscribe('tab-a', a);
		bus.subscribe('tab-b', b);
		const cmd: PaneCommand = { kind: 'history', delta: -1 };
		bus.dispatch('tab-a', cmd);
		expect(a).toHaveBeenCalledWith(cmd);
		expect(b).not.toHaveBeenCalled();
	});

	it('drops commands for tabs with no subscriber', () => {
		const bus = new PaneCommandBus();
		expect(() => bus.dispatch('ghost', { kind: 'history', delta: 1 })).not.toThrow();
	});

	it('unsubscribe removes only its own handler', () => {
		const bus = new PaneCommandBus();
		const first = vi.fn();
		const second = vi.fn();
		const unsubFirst = bus.subscribe('tab', first);
		bus.subscribe('tab', second); // remount replaces the handler
		unsubFirst(); // stale unsubscribe must not evict the new handler
		bus.dispatch('tab', { kind: 'navigate', path: ['a'] });
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});
