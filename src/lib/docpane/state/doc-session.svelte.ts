import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
	docOpen,
	docClose,
	docSummary,
	docApplyOp,
	docSetRootText,
	docUndo,
	docRedo,
	docSave,
	docBackupClear,
	IpcError,
	type IpcErrorKind,
} from '$lib/ipc/doc';
import type { ApplyResult, DocHandle, Op, OpenResult, OpenSource, Path } from '$lib/ipc/types';
import { isExpandable, rootRow } from '$lib/views/tree/logic/model';
import { basename } from '$lib/util/path';
import type { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import type { FindController } from '$lib/find/state/find.svelte';
import type { CompareController } from '$lib/views/compare/state/compare.svelte';
import { runAutoRepair, type RepairInfo } from '../logic/doc-repair';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { addRecent } from '$lib/shell/state/recents-store.svelte';

export interface DocSessionDeps {
	tree: TreeRowsController;
	find: FindController;
	compare: CompareController;
	setBusy: (busy: boolean) => void;
	setError: (msg: string | null) => void;

	getError: () => string | null;
	setSelectedPath: (path: Path | null) => void;

	clearViewState: () => void;

	flushPendingEdits: () => Promise<boolean>;

	flash: (msg: string) => void;

	cancelBackupTimer: () => void;

	confirmLargeFile?: (path: string) => Promise<boolean>;
}

export class DocSessionController {
	handle: DocHandle | null = $state(null);
	summary: OpenResult['summary'] | null = $state(null);
	sourceName: string | null = $state(null);

	repairInfo: RepairInfo | null = $state(null);

	private lastErrorKind: IpcErrorKind | null = null;

	constructor(private deps: DocSessionDeps) {}

	private load = async (opener: () => Promise<OpenResult>, name: string | null) => {
		this.deps.setBusy(true);
		this.deps.setError(null);
		this.lastErrorKind = null;
		try {
			await this.reset();
			const res = await opener();
			this.handle = res.handle;
			this.summary = res.summary;
			this.sourceName = name ?? res.summary.sourcePath ?? '(inline)';
			const root = rootRow(res.summary.rootKind, res.summary.rootChildCount);
			this.deps.tree.setRows([root]);
			this.deps.setSelectedPath(root.path);
			if (isExpandable(root)) {
				await this.deps.tree.toggleAt(0);
			}
		} catch (e) {
			this.deps.setError(String(e));
			this.lastErrorKind = e instanceof IpcError ? e.kind : null;
		} finally {
			this.deps.setBusy(false);
		}
	};

	loadFromSource = async (source: OpenSource) => {
		if (source.kind === 'file' && this.deps.confirmLargeFile) {
			const proceed = await this.deps.confirmLargeFile(source.path);
			if (!proceed) return;
		}
		const name = source.kind === 'file' ? source.path : (source.name ?? '(inline)');
		await this.load(() => docOpen(source), name);
		if (this.deps.getError() !== null) {
			await runAutoRepair(source, name, {
				enabled: () => behaviorPrefs.autoRepairOnPaste,
				error: () => this.deps.getError(),
				errorKind: () => this.lastErrorKind,
				reopen: (text, n) => this.load(() => docOpen({ kind: 'text', text, name: n }), n),
				handle: () => this.handle,
				setSummary: (s) => {
					this.summary = s;
				},
				setRepairInfo: (info) => {
					this.repairInfo = info;
				},
			});
		}
		if (source.kind === 'file' && this.deps.getError() === null) {
			addRecent(source.path, undefined, this.summary?.sourceSize);
		}
	};

	reset = async () => {
		if (this.handle) {
			this.clearBackup();
			try {
				await docClose(this.handle);
			} catch {
				// best-effort close on reset; the doc is being dropped either way
			}
		}
		await this.deps.compare.release(); // borrowed tab handles stay alive
		this.handle = null;
		this.summary = null;
		this.sourceName = null;
		this.repairInfo = null;
		this.deps.tree.setRows([]);
		this.deps.setSelectedPath(null);
		this.deps.clearViewState();
		this.deps.compare.clear();
		this.deps.find.reset();
		this.deps.setError(null);
	};

	dispose = () => {
		if (this.handle != null) void docClose(this.handle);
		void this.deps.compare.release();
	};

	refreshSummary = async () => {
		if (!this.handle) return;
		try {
			this.summary = await docSummary(this.handle);
		} catch {}
	};

	applyOp = async (op: Op): Promise<ApplyResult | null> => {
		if (!this.handle) return null;
		try {
			const result = await docApplyOp(this.handle, op);
			await this.refreshSummary();
			await this.deps.tree.refetchAfterOp(result.affectedPaths);
			if (this.deps.find.open && this.deps.find.query.trim()) {
				void this.deps.find.runSearch(this.deps.find.query);
			}
			return result;
		} catch (e) {
			this.deps.setError(String(e));
			return null;
		}
	};

	commitText = async (text: string): Promise<ApplyResult | null> => {
		if (!this.handle) return null;
		try {
			const result = await docSetRootText(this.handle, text);
			await this.refreshSummary();
			await this.deps.tree.refetchAfterOp(result.affectedPaths);
			if (this.deps.find.open && this.deps.find.query.trim()) {
				void this.deps.find.runSearch(this.deps.find.query);
			}
			return result;
		} catch (e) {
			this.deps.setError(String(e));
			return null;
		}
	};

	undo = async (): Promise<ApplyResult | null> => {
		if (!this.handle) return null;
		try {
			const result = await docUndo(this.handle);
			if (result === null) return null;
			await this.refreshSummary();
			await this.deps.tree.refetchAfterOp(result.affectedPaths);
			return result;
		} catch (e) {
			this.deps.setError(String(e));
			return null;
		}
	};

	redo = async (): Promise<ApplyResult | null> => {
		if (!this.handle) return null;
		try {
			const result = await docRedo(this.handle);
			if (result === null) return null;
			await this.refreshSummary();
			await this.deps.tree.refetchAfterOp(result.affectedPaths);
			return result;
		} catch (e) {
			this.deps.setError(String(e));
			return null;
		}
	};

	runHistory = async (delta: number) => {
		const n = Math.abs(delta);
		for (let i = 0; i < n; i++) {
			const r = delta < 0 ? await this.undo() : await this.redo();
			if (r === null) break; // stack exhausted
		}
	};

	save = async (opts: { silent?: boolean } = {}): Promise<boolean> => {
		if (!this.handle || !this.summary) return true;
		if (!(await this.deps.flushPendingEdits())) return false;
		if (!this.summary.fileBacked) {
			return this.saveAs(opts);
		}
		try {
			const res = await docSave(this.handle);
			this.clearBackup();
			await this.refreshSummary();
			if (!opts.silent) this.deps.flash(`saved ${basename(res.path)}`);
			return true;
		} catch (e) {
			this.deps.setError(String(e));
			return false;
		}
	};

	saveAs = async (opts: { silent?: boolean } = {}): Promise<boolean> => {
		if (!this.handle) return false;
		if (!(await this.deps.flushPendingEdits())) return false;
		let picked: string | null;
		try {
			picked = await saveDialog({
				defaultPath: this.defaultSaveName(),
				filters: [{ name: 'JSON', extensions: ['json'] }],
			});
		} catch (e) {
			this.deps.setError(String(e));
			return false;
		}
		if (typeof picked !== 'string') return false; // cancelled
		try {
			const res = await docSave(this.handle, picked);
			this.clearBackup();
			this.sourceName = picked;
			await this.refreshSummary();
			if (!opts.silent) this.deps.flash(`saved ${basename(res.path)}`);
			return true;
		} catch (e) {
			this.deps.setError(String(e));
			return false;
		}
	};

	private defaultSaveName(): string {
		const name = basename(this.sourceName ?? 'untitled.json');
		return /\.[^.]+$/.test(name) ? name.replace(/\.[^.]+$/, '.json') : `${name}.json`;
	}

	clearBackup = () => {
		this.deps.cancelBackupTimer();
		if (this.handle) void docBackupClear(this.handle).catch(() => {});
	};
}
