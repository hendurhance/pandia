import { parse, LosslessNumber, isLosslessNumber } from 'lossless-json';

const MAYBE_UNSAFE = /\d{16,}/;

function parseNumber(raw: string): unknown {
	const isInteger = !/[.eE]/.test(raw);
	if (isInteger && !Number.isSafeInteger(Number(raw))) {
		return new LosslessNumber(raw);
	}
	return parseFloat(raw);
}

export function parseLossless(json: string): unknown {
	if (!MAYBE_UNSAFE.test(json)) return JSON.parse(json);
	return parse(json, undefined, parseNumber);
}

export { isLosslessNumber };
