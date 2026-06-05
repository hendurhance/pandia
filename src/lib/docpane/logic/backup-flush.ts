import { docBackup } from '$lib/ipc/doc';
import type { DocHandle } from '$lib/ipc/types';

export interface BackupFlushDeps {
	handle: () => DocHandle | null;
	sourceName: () => string | null;
	
	isDirty: () => boolean;
	
	codeDirty: () => boolean;
	
	flushCodeBuffer: () => Promise<boolean>;
}

export const BACKUP_IDLE_MS = 750;

export function createBackupFlusher(deps: BackupFlushDeps) {
	async function flush(): Promise<void> {
		const h = deps.handle();
		if (!h || !deps.isDirty()) return;
		if (deps.codeDirty()) {
			const ok = await deps.flushCodeBuffer().catch(() => false);
			if (!ok) return;
		}
		void docBackup(h, deps.sourceName()).catch(() => {
			
		});
	}

	return { flush };
}
