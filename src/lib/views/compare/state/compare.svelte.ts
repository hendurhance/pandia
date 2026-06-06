import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { docOpen, docClose, docSummary } from '$lib/ipc/doc';
import type { DocHandle, OpenResult } from '$lib/ipc/types';
import type { CompareTarget } from '$lib/views/compare/logic/compare-target';

export interface CompareDeps {
	mainHandle: () => DocHandle | null;

	setViewMode: (mode: 'compare' | 'tree') => void;
	setBusy: (busy: boolean) => void;
	setError: (error: string | null) => void;

	isHandleAlive: (h: DocHandle) => boolean;
}

export class CompareController {
	handle: DocHandle | null = $state(null);
	summary: OpenResult['summary'] | null = $state(null);
	sourceName: string | null = $state(null);

	private borrowed = $state(false);

	constructor(private deps: CompareDeps) {}

	active = $derived(this.handle !== null);

	staleSource = $derived.by(
		() => this.borrowed && this.handle !== null && !this.deps.isHandleAlive(this.handle),
	);

	start = async (target: CompareTarget) => {
		if (target.kind === 'file') {
			await this.pickFile();
			return;
		}
		if (target.handle === this.deps.mainHandle()) return;
		this.deps.setBusy(true);
		this.deps.setError(null);
		try {
			await this.release();
			const summary = await docSummary(target.handle);
			this.handle = target.handle;
			this.summary = summary;
			this.sourceName = target.sourceName ?? 'tab';
			this.borrowed = true;
			this.deps.setViewMode('compare');
		} catch (e) {
			this.deps.setError(String(e));
		} finally {
			this.deps.setBusy(false);
		}
	};

	pickFile = async () => {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: [{ name: 'JSON', extensions: ['json', 'jsonc', 'json5', 'geojson'] }],
		});
		if (typeof picked !== 'string') return;
		this.deps.setBusy(true);
		this.deps.setError(null);
		try {
			await this.release();
			const res = await docOpen({ kind: 'file', path: picked });
			this.handle = res.handle;
			this.summary = res.summary;
			this.sourceName = picked;
			this.borrowed = false;
			this.deps.setViewMode('compare');
		} catch (e) {
			this.deps.setError(String(e));
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
				await docClose(this.handle);
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
