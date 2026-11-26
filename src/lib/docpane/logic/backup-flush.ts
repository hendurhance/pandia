import { ipc } from '$lib/ipc/client';
import type { DocHandle } from '$lib/ipc/bindings';

export interface BackupFlushDeps {
	handle: () => DocHandle | null;
	sourceName: () => string | null;

	isDirty: () => boolean;

	uncommittedText: () => string | null;

	bytes: () => number;
	now?: () => number;
}

export const BACKUP_IDLE_MS = 750;
const BACKUP_MAX_DELAY_MS = 30_000;
const BYTES_PER_EXTRA_SECOND = 10 * 1024 * 1024;

export function backupDelayMs(bytes: number): number {
	const extra = Math.floor(bytes / BYTES_PER_EXTRA_SECOND) * 1000;
	return Math.min(BACKUP_MAX_DELAY_MS, BACKUP_IDLE_MS + extra);
}

const writes = new Map<DocHandle, Promise<void>>();

export function inBackupOrder(handle: DocHandle, write: () => Promise<unknown>): Promise<void> {
	const next = (writes.get(handle) ?? Promise.resolve()).then(write).then(
		() => {},
		() => {},
	);
	writes.set(handle, next);
	void next.then(() => {
		if (writes.get(handle) === next) writes.delete(handle);
	});
	return next;
}

export function createBackupFlusher(deps: BackupFlushDeps) {
	const now = deps.now ?? Date.now;
	let lastAt = -Infinity;

	async function flushIfDue(): Promise<void> {
		if (now() - lastAt >= backupDelayMs(deps.bytes())) await flush();
	}

	async function flush(): Promise<void> {
		const h = deps.handle();
		if (!h || !deps.isDirty()) return;
		lastAt = now();
		const text = deps.uncommittedText();
		if (text !== null) {
			return inBackupOrder(h, () => ipc.docBackupText(h, deps.sourceName(), text));
		}
		return inBackupOrder(h, () => ipc.docBackup(h, deps.sourceName()));
	}

	return { flush, flushIfDue };
}
