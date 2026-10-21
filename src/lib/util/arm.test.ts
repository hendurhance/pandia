import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arm, ARM_MS } from './arm.svelte';

describe('Arm', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('first press arms without running the action', () => {
		const arm = new Arm();
		const action = vi.fn();
		arm.press(action);
		expect(arm.armed).toBe(true);
		expect(action).not.toHaveBeenCalled();
	});

	it('second press inside the window runs the action once and disarms', () => {
		const arm = new Arm();
		const action = vi.fn();
		arm.press(action);
		vi.advanceTimersByTime(ARM_MS - 1);
		arm.press(action);
		expect(action).toHaveBeenCalledTimes(1);
		expect(arm.armed).toBe(false);
		vi.advanceTimersByTime(ARM_MS);
		expect(arm.armed).toBe(false);
	});

	it('disarms after the window, so the next press re-arms instead of firing', () => {
		const arm = new Arm();
		const action = vi.fn();
		arm.press(action);
		vi.advanceTimersByTime(ARM_MS);
		expect(arm.armed).toBe(false);
		arm.press(action);
		expect(action).not.toHaveBeenCalled();
		expect(arm.armed).toBe(true);
	});
});
