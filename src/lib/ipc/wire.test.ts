import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
	decodeLossless,
	encodeLossless,
	asLosslessText,
	isLosslessNumber,
	LosslessNumber,
} from './wire';

const t = asLosslessText;

describe('decodeLossless', () => {
	it('keeps an integer beyond 2^53 lossless', () => {
		const v = decodeLossless(t('{"id":123456789012345678}')) as Record<string, unknown>;
		expect(isLosslessNumber(v.id)).toBe(true);
		expect(String(v.id)).toBe('123456789012345678');
	});

	it('leaves safe numbers as native', () => {
		const v = decodeLossless(t('{"n":42,"f":1.5,"neg":-7}')) as Record<string, number>;
		expect(v.n).toBe(42);
		expect(v.f).toBe(1.5);
		expect(v.neg).toBe(-7);
		expect(isLosslessNumber(v.n)).toBe(false);
	});

	it('uses the native parser when no long digit run is present', () => {
		expect(decodeLossless(t('[1,2,3]'))).toEqual([1, 2, 3]);
		expect(decodeLossless(t('{"a":"hi"}'))).toEqual({ a: 'hi' });
	});

	it('only the unsafe integer is lossless; siblings stay native', () => {
		const v = decodeLossless(t('{"big":123456789012345678,"small":5}')) as Record<string, unknown>;
		expect(isLosslessNumber(v.big)).toBe(true);
		expect(v.small).toBe(5);
	});
});

describe('encodeLossless', () => {
	it('writes a LosslessNumber back as its exact token', () => {
		expect(encodeLossless(new LosslessNumber('123456789012345678'))).toBe('123456789012345678');
		expect(encodeLossless({ id: new LosslessNumber('1.50') })).toBe('{"id":1.50}');
	});

	it('encodes plain values as standard JSON', () => {
		expect(encodeLossless('')).toBe('""');
		expect(encodeLossless(0)).toBe('0');
		expect(encodeLossless(false)).toBe('false');
		expect(encodeLossless(null)).toBe('null');
		expect(encodeLossless(['a', 1])).toBe('["a",1]');
	});

	it('round-trips decode → encode without perturbing tokens', () => {
		const src = t('{"big":12345678901234567890,"x":1.5,"s":"q"}');
		expect(encodeLossless(decodeLossless(src))).toBe(src);
	});
});

describe('decodeLossless against the Rust canonical fixture', () => {
	// Every number token the Rust renderer is tested with must survive
	// decode → encode byte-identically, fast path included. (String-escape and
	// key-order cases are the renderer's concern, not the decoder's.)
	const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
	const fixture = (
		JSON.parse(
			readFileSync(join(__dirname, '../../../src-tauri/src/doc/canonical_cases.json'), 'utf8'),
		) as { name: string; input: string }[]
	).filter((c) => JSON_NUMBER.test(c.input));

	it('covers a healthy share of the fixture', () => {
		expect(fixture.length).toBeGreaterThanOrEqual(15);
	});

	it.each(fixture)('$name: token survives the round trip', ({ input }) => {
		const wrapped = t(`{"v":${input}}`);
		expect(encodeLossless(decodeLossless(wrapped))).toBe(wrapped);
	});
});

describe('decodeLossless precision (numbers.json categories)', () => {
	function exact(json: string, key: string, token: string) {
		const v = decodeLossless(t(json)) as Record<string, unknown>;
		expect(isLosslessNumber(v[key]), `${key} should be lossless`).toBe(true);
		expect(String(v[key])).toBe(token);
	}

	it('keeps unrepresentable integers exact', () => {
		exact('{"a":9007199254740993}', 'a', '9007199254740993');
		exact('{"a":12345678901234567890}', 'a', '12345678901234567890');
		exact(
			'{"a":123456789012345678901234567890123456789012345678901234567890}',
			'a',
			'123456789012345678901234567890123456789012345678901234567890',
		);
		exact('{"a":-98765432109876543210987654321}', 'a', '-98765432109876543210987654321');
		exact('{"a":9223372036854775807}', 'a', '9223372036854775807');
		exact('{"a":18446744073709551615}', 'a', '18446744073709551615');
	});

	it('keeps high-precision decimals exact', () => {
		exact(
			'{"a":3.14159265358979323846264338327950288419716939937510582097494}',
			'a',
			'3.14159265358979323846264338327950288419716939937510582097494',
		);
		exact('{"a":0.000000000000000000000000000001}', 'a', '0.000000000000000000000000000001');
	});

	it('keeps exponent forms in their source spelling', () => {
		exact('{"a":1e308}', 'a', '1e308');
		exact('{"a":1e309}', 'a', '1e309');
		exact('{"a":1e-400}', 'a', '1e-400');
		exact('{"a":1E10}', 'a', '1E10');
		exact('{"a":2.5e+7}', 'a', '2.5e+7');
	});

	it('keeps trailing zeros even without a long digit run', () => {
		exact('{"a":1.50}', 'a', '1.50');
		exact('{"a":1.50000000000000000000}', 'a', '1.50000000000000000000');
	});

	it('-0, -0.0 and 0 stay distinct', () => {
		const v = decodeLossless(t('{"a":-0,"b":-0.0,"c":0}')) as Record<string, unknown>;
		expect(String(v.a)).toBe('-0');
		expect(String(v.b)).toBe('-0.0');
		expect(v.c).toBe(0);
		expect(isLosslessNumber(v.c)).toBe(false);
	});

	it('tokens whose text round-trips stay native numbers', () => {
		const v = decodeLossless(
			t(
				'{"artifact":0.30000000000000004,"denormal":5e-324,"exp":2.5e-7,"max":9007199254740991,"pow":9007199254740992}',
			),
		) as Record<string, unknown>;
		expect(v.artifact).toBe(0.30000000000000004);
		expect(v.denormal).toBe(5e-324);
		expect(v.exp).toBe(2.5e-7);
		expect(v.max).toBe(9007199254740991);
		expect(v.pow).toBe(9007199254740992);
		for (const k of Object.keys(v)) expect(isLosslessNumber(v[k]), k).toBe(false);
	});

	it('a lossless token does not perturb adjacent native values', () => {
		const v = decodeLossless(t('{"big":12345678901234567890,"x":1.5,"y":42}')) as Record<
			string,
			unknown
		>;
		expect(isLosslessNumber(v.big)).toBe(true);
		expect(v.x).toBe(1.5);
		expect(v.y).toBe(42);
	});
});
