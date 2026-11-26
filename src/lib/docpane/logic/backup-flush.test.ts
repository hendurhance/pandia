import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { backupDelayMs, createBackupFlusher, inBackupOrder } from './backup-flush';

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

describe('inBackupOrder', () => {
	it('clears a backup only after a write that was already running, so a save is never undone', async () => {
		vi.clearAllMocks();
		let finishWrite!: () => void;
		vi.mocked(ipc.docBackup).mockReturnValueOnce(new Promise((r) => (finishWrite = () => r(true))));
		const backup = createBackupFlusher({
			handle: () => 'doc-1' as never,
			sourceName: () => 'big.json',
			isDirty: () => true,
			uncommittedText: () => null,
			bytes: () => 0,
		});
		const writing = backup.flush();
		await Promise.resolve();
		expect(ipc.docBackup).toHaveBeenCalledOnce();
		const cleared = inBackupOrder('doc-1' as never, () => ipc.docBackupClear('doc-1'));
		await Promise.resolve();
		expect(ipc.docBackupClear).not.toHaveBeenCalled();
		finishWrite();
		await writing;
		await cleared;
		expect(ipc.docBackupClear).toHaveBeenCalledWith('doc-1');
	});
});
