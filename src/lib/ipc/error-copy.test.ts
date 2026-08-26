import { describe, it, expect } from 'vitest';
import { IpcError, type IpcErrorKind } from './error';
import { describeError } from './error-copy';

describe('describeError — backend kinds', () => {
	it('tooLarge formats sizes as human bytes and states the honest fix', () => {
		const e = new IpcError(
			'tooLarge',
			'document too large: 2147483649 bytes (limit 2147483648 bytes)',
			{ actual: 2147483649, limit: 2147483648 },
		);
		const msg = describeError(e);
		expect(msg).toBe(
			'This document is 2.00 GiB — the limit for this action is 2.00 GiB. Use a smaller file.',
		);
		expect(msg).not.toContain('bytes');
	});

	it('tooLarge without wire sizes still reads sanely', () => {
		expect(describeError(new IpcError('tooLarge', 'document too large'))).toBe(
			'This document is too large for this action. Use a smaller file.',
		);
	});

	it('rangeTooLarge owns up to being an app bug, not a document problem', () => {
		const e = new IpcError(
			'rangeTooLarge',
			'line range too large: 12000 lines requested (limit 5000 per call)',
			{ actual: 12000, limit: 5000 },
		);
		expect(describeError(e)).toBe(
			'Pandia requested 12000 lines at once (the limit is 5000). This is a bug in Pandia, not a problem with your document.',
		);
	});

	it('parse uses the structured detail, never re-parsing message prose', () => {
		const e = new IpcError('parse', 'parse error: expected value at line 3 column 7', {
			detail: 'expected value at line 3 column 7',
		});
		expect(describeError(e)).toBe("This isn't valid JSON: expected value at line 3 column 7.");
	});

	it('parse without detail still leads with plain language', () => {
		expect(describeError(new IpcError('parse', 'parse error: x'))).toBe("This isn't valid JSON.");
	});

	it('notFound tells the user what to do, not which handle is stale', () => {
		const e = new IpcError('notFound', 'document not found: 3f8a1c2e-0000-0000-0000-000000000000');
		const msg = describeError(e);
		expect(msg).toBe('This document is no longer open. Reopen the file and try again.');
		expect(msg).not.toContain('3f8a1c2e');
	});

	it('invalidPath renders the structured path, not the message prose', () => {
		const e = new IpcError('invalidPath', 'invalid path: $.events[15].timestamp', {
			path: ['events', 15, 'timestamp'],
		});
		expect(describeError(e)).toBe(
			'$.events[15].timestamp no longer exists in this document — it may have been changed or removed by an earlier edit.',
		);
	});

	it('invalidPath without a path still reads sanely', () => {
		expect(describeError(new IpcError('invalidPath', 'invalid path'))).toBe(
			'That location no longer exists in this document — it may have been changed or removed by an earlier edit.',
		);
	});

	it('edit, schema, export, io lead with plain language and keep the detail', () => {
		expect(
			describeError(
				new IpcError('edit', 'edit error: key "foo" already exists', {
					detail: 'key "foo" already exists',
				}),
			),
		).toBe('This edit can\'t be applied: key "foo" already exists.');
		expect(
			describeError(
				new IpcError('schema', 'schema error: not an object', { detail: 'not an object' }),
			),
		).toBe("This schema can't be used: not an object.");
		expect(
			describeError(
				new IpcError('export', 'export error: unsupported value', {
					detail: 'unsupported value',
				}),
			),
		).toBe('Export failed: unsupported value.');
		expect(
			describeError(
				new IpcError('io', 'io error: No such file or directory (os error 2)', {
					detail: 'No such file or directory (os error 2)',
				}),
			),
		).toBe("Couldn't read or write the file: No such file or directory (os error 2).");
	});

	it('cancelled stays terse', () => {
		expect(describeError(new IpcError('cancelled', 'cancelled'))).toBe('Cancelled.');
	});
});

describe('describeError — degradation', () => {
	it('an unrecognised kind falls back to the wire message', () => {
		const e = new IpcError('quotaExceeded' as IpcErrorKind, 'quota exceeded on backend');
		expect(describeError(e)).toBe('quota exceeded on backend.');
	});

	it('an unrecognised kind with an empty message falls back to generic copy', () => {
		const e = new IpcError('quotaExceeded' as IpcErrorKind, '   ');
		expect(describeError(e)).toBe('Something went wrong.');
	});

	it('a plain Error shows its message without the "Error:" prefix', () => {
		expect(describeError(new Error('HTTP 404 Not Found'))).toBe('HTTP 404 Not Found.');
	});

	it('non-errors never produce "[object Object]" or an empty string', () => {
		for (const junk of [null, undefined, {}, { weird: true }, 42, new Error(''), '']) {
			const msg = describeError(junk);
			expect(msg).toBe('Something went wrong.');
		}
		expect(describeError('plain thrown string')).toBe('plain thrown string.');
	});
});
