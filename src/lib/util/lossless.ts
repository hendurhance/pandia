import { parse, LosslessNumber, isLosslessNumber } from 'lossless-json';

const MAYBE_LOSSY = /[\d.]{16,}|\d[eE]|-0|\.\d*0(?!\d)|\.0{6}/;

function parseNumber(raw: string): unknown {
	const n = Number(raw);
	return String(n) === raw ? n : new LosslessNumber(raw);
}

export function parseLossless(json: string): unknown {
	if (!MAYBE_LOSSY.test(json)) return JSON.parse(json);
	return parse(json, undefined, parseNumber);
}

export { isLosslessNumber };
