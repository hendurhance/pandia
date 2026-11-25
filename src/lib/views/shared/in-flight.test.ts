import { describe, expect, it } from 'vitest';
import { InFlight } from './in-flight';

describe('InFlight', () => {
	it('joins a second request for the same key instead of starting another', async () => {
		const loads = new InFlight<string>();
		let started = 0;
		let finish!: () => void;
		const start = () => {
			started++;
			return new Promise<void>((r) => (finish = r));
		};
		const first = loads.run('a', start);
		const second = loads.run('a', start);
		expect(second).toBe(first);
		expect(started).toBe(1);
		finish();
		await first;
		expect(loads.size).toBe(0);
	});

	it('forgets a request when it fails, so the next one starts fresh', async () => {
		const loads = new InFlight<string>();
		await expect(loads.run('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
		expect(loads.get('a')).toBeUndefined();
	});

	it('does not drop a newer request when an older one finishes after a clear', async () => {
		const loads = new InFlight<string>();
		let finishOld!: () => void;
		const old = loads.run('a', () => new Promise<void>((r) => (finishOld = r)));
		loads.clear();
		const fresh = loads.run('a', () => new Promise<void>(() => {}));
		finishOld();
		await old;
		expect(loads.get('a')).toBe(fresh);
	});
});
