// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { ipc } from '$lib/ipc/client';
import type { Summary } from '$lib/ipc/bindings';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { DocumentSession, type DocumentSessionDeps } from './document-session.svelte';
import { BACKUP_IDLE_MS } from '../logic/backup-flush';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docBackup: vi.fn(async () => true),
		docBackupClear: vi.fn(async () => null),
		docClose: vi.fn(async () => true),
		docSummary: vi.fn(),
	},
}));
vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

function deps(): DocumentSessionDeps {
	return {
		isActive: () => true,
		onOpenInNewTab: () => {},
		isHandleAlive: () => true,
		code: { api: () => null, dirty: () => false },
		graphApi: () => null,
		clearViewState: () => {},
	};
}

function summary(version: number, dirty: boolean): Summary {
	return {
		rootKind: 'object',
		rootChildCount: 1,
		sourcePath: '/w/a.json',
		sourceSize: 10,
		lazy: false,
		version,
		dirty,
		fileBacked: true,
		recoveryNote: null,
		commentsStripped: false,
	};
}

afterEach(() => vi.useRealTimers());

describe('crash-recovery backup after undoing back to the saved file', () => {
	it('removes the backup once the document is clean again, so a normal close leaves none', () => {
		vi.useFakeTimers();
		const { result: doc, destroy } = inRoot(() => new DocumentSession(deps()));
		doc.session.handle = 'h' as never;
		doc.session.sourceName = '/w/a.json';

		doc.session.summary = summary(1, true);
		flushSync();
		vi.advanceTimersByTime(BACKUP_IDLE_MS);
		expect(ipc.docBackup).toHaveBeenCalledTimes(1);

		doc.session.summary = summary(2, false);
		flushSync();
		vi.advanceTimersByTime(BACKUP_IDLE_MS * 4);
		window.dispatchEvent(new Event('blur'));

		doc.dispose();
		destroy();

		const cleared =
			vi.mocked(ipc.docBackupClear).mock.calls.some(([id]) => id === 'h') ||
			vi.mocked(ipc.docBackup).mock.calls.length > 1;
		expect(cleared, 'backup file for a clean, closed document was never removed').toBe(true);
	});
});
