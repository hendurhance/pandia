import { describe, it, expect } from 'vitest';
import { IpcError, toIpcError } from './error';

describe('IpcError', () => {
	it('stringifies to the bare message so existing String(e) displays are unchanged', () => {
		const e = new IpcError('tooLarge', 'document too large: 2GB (limit 1GB)');
		expect(String(e)).toBe('document too large: 2GB (limit 1GB)');
		expect(`${e}`).toBe('document too large: 2GB (limit 1GB)');
		expect('' + e).toBe('document too large: 2GB (limit 1GB)');
		expect(e.message).toBe('document too large: 2GB (limit 1GB)');
	});
	it('carries the structured kind for branching, and is a real Error', () => {
		const e = new IpcError('parse', 'parse error: x');
		expect(e.kind).toBe('parse');
		expect(e instanceof Error).toBe(true);
	});
});

describe('toIpcError', () => {
	it('wraps a { kind, message } rejection into a typed IpcError', () => {
		const e = toIpcError({ kind: 'notFound', message: 'document not found' });
		expect(e).toBeInstanceOf(IpcError);
		expect((e as IpcError).kind).toBe('notFound');
		expect(String(e)).toBe('document not found');
	});
	it('passes non-wire rejections through unchanged', () => {
		const err = new Error('boom');
		expect(toIpcError(err)).toBe(err);
		expect(toIpcError('plain string')).toBe('plain string');
		expect(toIpcError(null)).toBe(null);
	});
});
