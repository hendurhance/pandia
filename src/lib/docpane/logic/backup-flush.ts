import { ipc } from '$lib/ipc/client';
import type { DocHandle } from '$lib/ipc/bindings';

export interface BackupFlushDeps {
	handle: () => DocHandle | null;
	sourceName: () => string | null;

	isDirty: () => boolean;

	uncommittedText: () => string | null;
}

export const BACKUP_IDLE_MS = 750;

export function createBackupFlusher(deps: BackupFlushDeps) {
	async function flush(): Promise<void> {
		const h = deps.handle();
		if (!h || !deps.isDirty()) return;
		const text = deps.uncommittedText();
		if (text !== null) {
			void ipc.docBackupText(h, deps.sourceName(), text).catch(() => {});
			return;
		}
		void ipc.docBackup(h, deps.sourceName()).catch(() => {});
	}

	return { flush };
}
