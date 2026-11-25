import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { backupDelayMs, createBackupFlusher } from './backup-flush';

vi.mock('$lib/ipc/client', async () => ({ ipc: (await import('$lib/ipc/fake')).fakeIpc() }));

const MB = 1024 * 1024;

describe('backupDelayMs', () => {
	it('backs up a small document 750 ms after typing stops', () => {
		expect(backupDelayMs(0)).toBe(750);
		expect(backupDelayMs(9 * MB)).toBe(750);
	});

	it('waits about a second longer per 10 MB, up to 30 seconds', () => {
		expect(backupDelayMs(150 * MB)).toBe(15_750);
		expect(backupDelayMs(2048 * MB)).toBe(30_000);
	});
});

describe('flushIfDue', () => {
	let now = 0;
	function flusher(bytes: number) {
		return createBackupFlusher({
			handle: () => 'h' as never,
			sourceName: () => 'big.json',
			isDirty: () => true,
			uncommittedText: () => null,
			bytes: () => bytes,
			now: () => now,
		});
	}

	beforeEach(() => {
		now = 1_000_000;
		vi.clearAllMocks();
	});

	it('skips a window-switch backup of a big document that was backed up moments ago', async () => {
		const backup = flusher(150 * MB);
		await backup.flush();
		now += 5_000;
		await backup.flushIfDue();
		expect(ipc.docBackup).toHaveBeenCalledTimes(1);

		now += 11_000;
		await backup.flushIfDue();
		expect(ipc.docBackup).toHaveBeenCalledTimes(2);
	});

	it('always backs up a small document on a window switch', async () => {
		const backup = flusher(MB);
		await backup.flush();
		now += 1_000;
		await backup.flushIfDue();
		expect(ipc.docBackup).toHaveBeenCalledTimes(2);
	});
});
