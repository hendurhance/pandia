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
			void ipc.docBackupText(h, deps.sourceName(), text).catch(() => {});
			return;
		}
		void ipc.docBackup(h, deps.sourceName()).catch(() => {});
	}

	return { flush, flushIfDue };
}
