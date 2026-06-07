import { describe, expect, it } from 'vitest';
import { makeNonceGate } from './nonce-gate';

describe('makeNonceGate', () => {
	it('returns false on a null request', () => {
		const gate = makeNonceGate();
		expect(gate(null, 'a', true)).toBe(false);
	});

	it('returns false when the tab id does not match', () => {
		const gate = makeNonceGate();
		expect(gate({ nonce: 1, tabId: 'b' }, 'a', true)).toBe(false);
	});

	it('returns false when the pane is inactive', () => {
		const gate = makeNonceGate();
		expect(gate({ nonce: 1, tabId: 'a' }, 'a', false)).toBe(false);
	});

	it('returns true on the first matching+active request, false on repeats', () => {
		const gate = makeNonceGate();
		expect(gate({ nonce: 1, tabId: 'a' }, 'a', true)).toBe(true);
		expect(gate({ nonce: 1, tabId: 'a' }, 'a', true)).toBe(false);
	});

	it('re-fires when the nonce advances', () => {
		const gate = makeNonceGate();
		expect(gate({ nonce: 1, tabId: 'a' }, 'a', true)).toBe(true);
		expect(gate({ nonce: 2, tabId: 'a' }, 'a', true)).toBe(true);
	});

	it('does not advance last-seen when the gate rejects (different tab)', () => {
		const gateA = makeNonceGate();
		gateA({ nonce: 1, tabId: 'b' }, 'a', true); // rejected
		expect(gateA({ nonce: 1, tabId: 'a' }, 'a', true)).toBe(true);
	});

	it('does not advance last-seen when the pane is inactive', () => {
		const gate = makeNonceGate();
		gate({ nonce: 1, tabId: 'a' }, 'a', false); // rejected (inactive)
		expect(gate({ nonce: 1, tabId: 'a' }, 'a', true)).toBe(true);
	});
});
