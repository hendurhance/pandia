import { parse, stringify, LosslessNumber, isLosslessNumber } from 'lossless-json';
import type { NodeKind } from './bindings';

export type LosslessText = string & { readonly __brand: 'LosslessText' };

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| LosslessNumber
	| JsonValue[]
	| { [key: string]: JsonValue };

export function kindOf(v: unknown): NodeKind {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return 'bool';
	if (typeof v === 'number') return 'number';
	if (isLosslessNumber(v)) return 'number';
	if (typeof v === 'string') return 'string';
	if (Array.isArray(v)) return 'array';
	return 'object';
}

const MAYBE_LOSSY = /[\d.]{16,}|\d[eE]|-0|\.\d*0(?!\d)|\.0{6}/;

function parseNumber(raw: string): unknown {
	const n = Number(raw);
	return String(n) === raw ? n : new LosslessNumber(raw);
}

export function decodeLossless(text: LosslessText): JsonValue {
	if (!MAYBE_LOSSY.test(text)) return JSON.parse(text) as JsonValue;
	return parse(text, undefined, parseNumber) as JsonValue;
}

export function encodeLossless(value: unknown): LosslessText {
	return (stringify(value) ?? 'null') as LosslessText;
}

export function asLosslessText(rawJson: string): LosslessText {
	return rawJson as LosslessText;
}

export { isLosslessNumber, LosslessNumber };
