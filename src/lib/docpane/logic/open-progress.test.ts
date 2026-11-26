import { describe, it, expect } from 'vitest';
import { describeOpening, fmtElapsed } from './open-progress';

const GiB = 1024 ** 3;

describe('describeOpening', () => {
	it('says it is opening before the first update arrives', () => {
		expect(describeOpening(null)).toEqual({ step: 'Opening', detail: '', fraction: 0 });
	});

	it('names the step and how far through the file it is', () => {
		expect(describeOpening({ phase: 'checking', done: 2 * GiB, total: 4 * GiB })).toEqual({
			step: 'Checking the JSON',
			detail: '2.00 GiB of 4.00 GiB',
			fraction: 0.5,
		});
	});
});

describe('fmtElapsed', () => {
	it('shows seconds, then minutes with padded seconds', () => {
		expect(fmtElapsed(900)).toBe('0 s');
		expect(fmtElapsed(42_000)).toBe('42 s');
		expect(fmtElapsed(65_000)).toBe('1 min 05 s');
	});
});
