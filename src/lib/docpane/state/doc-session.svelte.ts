import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { ipc } from '$lib/ipc/client';
import { describeError, describeOpenFailure } from '$lib/ipc/error-copy';
import type {
	ApplyResult,
	Diagnosis,
	DetectKind,
	DocHandle,
	Op,
	OpenNotes,
	OpenOutcome,
	OpenSource,
	Path,
	Summary,
} from '$lib/ipc/bindings';
import { isExpandable, rootRow } from '$lib/views/tree/logic/model';
import { basename } from '$lib/util/path';
import type { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import type { FindController } from '$lib/find/state/find.svelte';
import type { CompareController } from '$lib/views/compare/state/compare.svelte';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import { addRecent } from '$lib/shell/state/recents-store.svelte';
import type { Handoff } from '$lib/shell/state/handoff';

const MAX_NOTES = 6;

const FORMAT_NAMES: Record<DetectKind, string> = {
	json: 'JSON',
	yaml: 'YAML',
	xml: 'XML',
	csv: 'CSV',
	curl: 'a cURL command',
	unknown: 'another format',
};

/** What Pandia changed so a document could be opened, shown in a banner above it. */
export interface RepairInfo {
	title: string;
	notes: string[];
	more: number;
}

function repairInfoFrom(notes: OpenNotes): RepairInfo | null {
	if (notes.convertedFrom) {
		return { title: `converted from ${FORMAT_NAMES[notes.convertedFrom]}`, notes: [], more: 0 };
	}
	if (notes.repairs.length === 0) return null;
	return {
		title: 'repaired',
		notes: notes.repairs.slice(0, MAX_NOTES),
		more: Math.max(0, notes.repairs.length - MAX_NOTES),
	};
}

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

	applyDefaultView: (summary: Summary | null) => Promise<void>;

	flash: (msg: string) => void;

	cancelBackupTimer: () => void;

	confirmCommentLoss?: (name: string) => Promise<'save' | 'saveAs' | 'cancel'>;
}

export class DocSessionController {
	handle: DocHandle | null = $state(null);
	summary: Summary | null = $state(null);
	sourceName: string | null = $state(null);

	repairInfo: RepairInfo | null = $state(null);
	diagnosis: Diagnosis | null = $state(null);
	refreshing = $state(false);

	handoff: Handoff | null = null;

	private loadSeq = 0;
	private disposed = false;
	private failedName: string | null = null;

	constructor(private deps: DocSessionDeps) {}

	private load = async (opener: () => Promise<OpenOutcome>): Promise<boolean> => {
		const seq = ++this.loadSeq;
		this.deps.setBusy(true);
		this.deps.setError(null);
		try {
			await this.reset();
			const outcome = await opener();
			if (seq !== this.loadSeq || this.disposed) {
				if (outcome.kind === 'opened') void ipc.docClose(outcome.handle).catch(() => {});
				return false;
			}
			if (outcome.kind === 'failed') {
				this.deps.setError(describeOpenFailure(outcome));
				this.diagnosis = outcome.diagnosis;
				return false;
			}
			this.handle = outcome.handle;
			this.summary = outcome.summary;
			this.sourceName = outcome.summary.sourcePath ?? '(inline)';
			this.repairInfo = repairInfoFrom(outcome.notes);
			const root = rootRow(outcome.summary.rootKind, outcome.summary.rootChildCount);
			this.deps.tree.setRows([root]);
			this.deps.setSelectedPath(root.path);
			if (isExpandable(root)) {
				await this.deps.tree.toggleAt(0);
			}
			return true;
		} catch (e) {
			if (seq === this.loadSeq) this.deps.setError(describeError(e));
			return false;
		} finally {
			if (seq === this.loadSeq) this.deps.setBusy(false);
		}
	};

	loadFromSource = async (source: OpenSource): Promise<boolean> => {
		await this.deps.applyDefaultView(null);
		await behaviorPrefs.init();
		const repair = behaviorPrefs.autoRepairOnOpen;
		if (!(await this.load(() => ipc.docOpen(source, { repair })))) {
			this.failedName =
				source.kind === 'file'
					? basename(source.path)
					: source.kind === 'text'
						? source.name
						: 'stdin';
			return false;
		}
		if (source.kind === 'file') addRecent(source.path, undefined, this.summary?.sourceSize);
		await this.deps.applyDefaultView(this.summary);
		return true;
	};

	applyDiagnosisFix = async (text: string): Promise<boolean> => {
		this.diagnosis = null;
		return this.loadFromSource({ kind: 'text', text, name: this.failedName ?? 'pasted.json' });
	};

	reset = async () => {
		if (this.handle) {
			this.clearBackup();
			try {
				await ipc.docClose(this.handle);
			} catch {
				// best-effort close on reset; the doc is being dropped either way
			}
		}
		await this.deps.compare.release(); // borrowed tab handles stay alive
		this.handle = null;
		this.summary = null;
		this.sourceName = null;
		this.repairInfo = null;
		this.diagnosis = null;
		this.deps.tree.setRows([]);
		this.deps.setSelectedPath(null);
		this.deps.clearViewState();
		this.deps.compare.clear();
		this.deps.find.reset();
		this.deps.setError(null);
	};

	dispose = () => {
		this.disposed = true;
		if (this.handle != null) void ipc.docClose(this.handle);
		void this.deps.compare.release();
	};

	refreshSummary = async () => {
		if (!this.handle) return;
		try {
			this.summary = await ipc.docSummary(this.handle);
		} catch {}
	};

	reloadAfter = async (affectedPaths: Path[]) => {
		this.refreshing = true;
		try {
			await this.refreshSummary();
			await this.deps.tree.refetchAfterOp(affectedPaths);
		} finally {
			this.refreshing = false;
		}
	};

	private afterMutation = async (result: ApplyResult) => {
		await this.reloadAfter(result.affectedPaths);
		this.deps.find.refreshAfterEdit();
	};

	private mutate = async (
		run: (handle: DocHandle) => Promise<ApplyResult | null>,
	): Promise<ApplyResult | null> => {
		if (!this.handle) return null;
		try {
			const result = await run(this.handle);
			if (result === null) return null;
			await this.afterMutation(result);
			return result;
		} catch (e) {
			this.deps.setError(describeError(e));
			return null;
		}
	};

	applyOp = (op: Op): Promise<ApplyResult | null> => this.mutate((h) => ipc.docApplyOp(h, op));

	commitText = (text: string): Promise<ApplyResult | null> =>
		this.mutate((h) => ipc.docSetRootText(h, text));

	undo = (): Promise<ApplyResult | null> => this.mutate((h) => ipc.docUndo(h));

	redo = (): Promise<ApplyResult | null> => this.mutate((h) => ipc.docRedo(h));

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
		if (this.handoff?.repliesToTerminal) return this.sendBack(this.handoff, opts);
		if (!this.summary.fileBacked) {
			return this.saveAs(opts);
		}
		if (this.summary.commentsStripped) {
			if (opts.silent) return false;
			const choice =
				(await this.deps.confirmCommentLoss?.(basename(this.sourceName ?? 'this file'))) ?? 'save';
			if (choice === 'cancel') return false;
			if (choice === 'saveAs') return this.saveAs(opts);
		}
		try {
			const res = await ipc.docSave(this.handle, null);
			this.clearBackup();
			this.handoff?.recordSave();
			await this.refreshSummary();
			if (!opts.silent) this.deps.flash(`saved ${basename(res.path)}`);
			return true;
		} catch (e) {
			this.deps.setError(describeError(e));
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
			this.deps.setError(describeError(e));
			return false;
		}
		if (typeof picked !== 'string') return false; // cancelled
		try {
			const res = await ipc.docSave(this.handle, picked);
			this.clearBackup();
			this.handoff?.recordSave();
			this.sourceName = picked;
			await this.refreshSummary();
			if (!opts.silent) this.deps.flash(`saved ${basename(res.path)}`);
			return true;
		} catch (e) {
			this.deps.setError(describeError(e));
			return false;
		}
	};

	private sendBack = async (handoff: Handoff, opts: { silent?: boolean }): Promise<boolean> => {
		if (!this.handle) return false;
		try {
			await handoff.sendBack(this.handle);
			this.clearBackup();
			await this.refreshSummary();
			if (!opts.silent) this.deps.flash('sent back to the terminal');
			return true;
		} catch (e) {
			this.deps.setError(describeError(e));
			return false;
		}
	};

	private defaultSaveName(): string {
		const name = basename(this.sourceName ?? 'untitled.json');
		return /\.[^.]+$/.test(name) ? name.replace(/\.[^.]+$/, '.json') : `${name}.json`;
	}

	clearBackup = () => {
		this.deps.cancelBackupTimer();
		if (this.handle) void ipc.docBackupClear(this.handle).catch(() => {});
	};
}
