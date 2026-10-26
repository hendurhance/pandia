import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ipc } from '$lib/ipc/client';
import { describeError, describeOpenFailure } from '$lib/ipc/error-copy';
import type { DocHandle, Summary } from '$lib/ipc/bindings';
import type { CompareTarget } from '$lib/views/compare/logic/compare-target';
import { JSON_OPEN_FILTERS } from '$lib/util/file-types';

export interface CompareDeps {
	mainHandle: () => DocHandle | null;
	flushEdits: () => Promise<boolean>;

	setViewMode: (mode: 'compare' | 'tree') => void;
	setBusy: (busy: boolean) => void;
	setError: (error: string | null) => void;

	isHandleAlive: (h: DocHandle) => boolean;
}

export class CompareController {
	handle: DocHandle | null = $state(null);
	summary: Summary | null = $state(null);
	sourceName: string | null = $state(null);

	private borrowed = $state(false);

	constructor(private deps: CompareDeps) {}

	active = $derived(this.handle !== null);

	staleSource = $derived.by(
		() => this.borrowed && this.handle !== null && !this.deps.isHandleAlive(this.handle),
	);

	start = async (target: CompareTarget) => {
		if (target.kind === 'file') return this.pickFile();
		if (!(await this.deps.flushEdits())) return;
		if (target.kind === 'path') return this.openFile(target.path);
		if (target.handle === this.deps.mainHandle()) return;
		this.deps.setBusy(true);
		this.deps.setError(null);
		try {
			const summary = await ipc.docSummary(target.handle);
			await this.release();
			this.handle = target.handle;
			this.summary = summary;
			this.sourceName = target.sourceName ?? 'tab';
			this.borrowed = true;
			this.deps.setViewMode('compare');
		} catch (e) {
			this.deps.setError(describeError(e));
		} finally {
			this.deps.setBusy(false);
		}
	};

	pickFile = async () => {
		if (!(await this.deps.flushEdits())) return;
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: JSON_OPEN_FILTERS,
		});
		if (typeof picked === 'string') await this.openFile(picked);
	};

	openFile = async (path: string) => {
		this.deps.setBusy(true);
		this.deps.setError(null);
		try {
			const res = await ipc.docOpen({ kind: 'file', path }, { repair: false });
			if (res.kind === 'failed') {
				this.deps.setError(describeOpenFailure(res));
				return;
			}
			await this.release();
			this.handle = res.handle;
			this.summary = res.summary;
			this.sourceName = path;
			this.borrowed = false;
			this.deps.setViewMode('compare');
		} catch (e) {
			this.deps.setError(describeError(e));
		} finally {
			this.deps.setBusy(false);
		}
	};

	exit = async () => {
		await this.release();
		this.clear();
		this.deps.setViewMode('tree');
	};

	release = async () => {
		if (this.handle && !this.borrowed) {
			try {
				await ipc.docClose(this.handle);
			} catch {}
		}
	};

	clear = () => {
		this.handle = null;
		this.summary = null;
		this.sourceName = null;
		this.borrowed = false;
	};
}
