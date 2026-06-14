import { describe, it, expect } from 'vitest';
import { parseLossless, isLosslessNumber } from './lossless';

describe('parseLossless', () => {
	it('keeps an integer beyond 2^53 lossless', () => {
		const v = parseLossless('{"id":123456789012345678}') as Record<string, unknown>;
		expect(isLosslessNumber(v.id)).toBe(true);
		expect(String(v.id)).toBe('123456789012345678');
	});

	it('leaves safe numbers as native', () => {
		const v = parseLossless('{"n":42,"f":1.5,"neg":-7}') as Record<string, number>;
		expect(v.n).toBe(42);
		expect(v.f).toBe(1.5);
		expect(v.neg).toBe(-7);
		expect(isLosslessNumber(v.n)).toBe(false);
	});

	it('uses the native parser when no long digit run is present', () => {
		expect(parseLossless('[1,2,3]')).toEqual([1, 2, 3]);
		expect(parseLossless('{"a":"hi"}')).toEqual({ a: 'hi' });
	});

	it('only the unsafe integer is lossless; siblings stay native', () => {
		const v = parseLossless('{"big":123456789012345678,"small":5}') as Record<string, unknown>;
		expect(isLosslessNumber(v.big)).toBe(true);
		expect(v.small).toBe(5);
	});
});
