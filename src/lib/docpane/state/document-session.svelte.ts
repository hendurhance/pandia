import type { DocHandle, OpenSource } from '$lib/ipc/bindings';
import type { CodeViewApi } from '$lib/views/code/CodeView.svelte';
import type { GraphViewApi } from '$lib/views/graph/components/GraphView.svelte';
import { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import { createNodeActions, type CutMark } from '$lib/views/tree/logic/node-actions';
import { CompareController } from '$lib/views/compare/state/compare.svelte';
import { FindController } from '$lib/find/state/find.svelte';
import { PromptController } from '$lib/ui/prompt.svelte';
import { DocEditController } from './doc-edit.svelte';
import { DocSessionController } from './doc-session.svelte';
import { DocNavController } from './doc-nav.svelte';
import { createDocMenuActions } from '../logic/doc-menu-actions';
import { resolveDefaultView } from '../logic/default-view';
import { createBackupFlusher, BACKUP_IDLE_MS } from '../logic/backup-flush';
import { createAutoSaver } from '../logic/auto-save';
import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';

export type ViewMode = 'tree' | 'code' | 'grid' | 'graph' | 'compare';

export interface DocumentSessionDeps {
	isActive: () => boolean;
	onOpenInNewTab: (source: OpenSource) => void;
	isHandleAlive: (h: DocHandle) => boolean;
	confirmLargeFile?: (path: string) => Promise<boolean>;
	confirmCommentLoss?: (name: string) => Promise<'save' | 'saveAs' | 'cancel'>;
	/** Code-view bridge — the CodeMirror buffer lives in the pane. */
	code: {
		api: () => CodeViewApi | null;
		dirty: () => boolean;
	};
	graphApi: () => GraphViewApi | null;
	/** Pane-owned view state cleared on document switch (grid schema etc.). */
	clearViewState: () => void;
}

const SAVE_FLASH_MS = 1500;

export class DocumentSession {
	busy = $state(false);
	error: string | null = $state(null);
	viewMode: ViewMode = $state('tree');
	saveFlash: string | null = $state(null);
	cutMark: CutMark | null = $state(null);

	readonly prompt = new PromptController();
	readonly tree: TreeRowsController;
	readonly edit: DocEditController;
	readonly find: FindController;
	readonly compare: CompareController;
	readonly session: DocSessionController;
	readonly nav: DocNavController;
	readonly nodeActions: ReturnType<typeof createNodeActions>;
	readonly menuAction: ReturnType<typeof createDocMenuActions>;

	readonly isDirty = $derived.by(
		() => (this.session.summary?.dirty ?? false) || this.deps.code.dirty(),
	);

	private backupTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private deps: DocumentSessionDeps) {
		const setError = (e: string | null) => {
			this.error = e;
		};

		this.tree = new TreeRowsController({
			handle: () => this.session.handle,
			summary: () => this.session.summary,
			setError,
		});

		this.edit = new DocEditController({
			rows: () => this.tree.rows,
			handle: () => this.session.handle,
			apply: (op) => this.session.applyOp(op),
			setError,
		});

		this.find = new FindController({
			handle: () => this.session.handle,
			canOpen: () => !!this.session.summary,
			isCodeView: () => this.viewMode === 'code',
			isGraphView: () => this.viewMode === 'graph',
			switchToTree: () => {
				if (this.viewMode !== 'tree') this.viewMode = 'tree';
			},
			codeApi: () => deps.code.api(),
			openGraphSearch: () => deps.graphApi()?.openSearch(),
			navigateToHit: (path) => this.nav.navigateTo(path),
			afterReplace: async (affectedPaths) => {
				await this.session.refreshSummary();
				await this.tree.refetchAfterOp(affectedPaths);
			},
		});

		this.compare = new CompareController({
			mainHandle: () => this.session.handle,
			isHandleAlive: (h) => deps.isHandleAlive(h),
			setViewMode: (mode) => {
				this.viewMode = mode;
			},
			setBusy: (b) => {
				this.busy = b;
			},
			setError,
		});

		this.session = new DocSessionController({
			tree: this.tree,
			find: this.find,
			compare: this.compare,
			setBusy: (b) => {
				this.busy = b;
			},
			setError,
			getError: () => this.error,
			setSelectedPath: (p) => this.nav.select(p),
			clearViewState: () => deps.clearViewState(),
			flushPendingEdits: async () => {
				const api = deps.code.api();
				if (this.viewMode === 'code' && deps.code.dirty() && api) return api.flush();
				return true;
			},
			applyDefaultView: async (summary) => {
				await sidebarPrefs.init();
				this.viewMode = resolveDefaultView(sidebarPrefs.defaultView, summary);
			},
			flash: (msg) => this.flash(msg),
			cancelBackupTimer: () => {
				if (this.backupTimer) clearTimeout(this.backupTimer);
			},
			confirmLargeFile: (p) =>
				deps.confirmLargeFile ? deps.confirmLargeFile(p) : Promise.resolve(true),
			confirmCommentLoss: (n) =>
				deps.confirmCommentLoss ? deps.confirmCommentLoss(n) : Promise.resolve('save' as const),
		});

		this.nav = new DocNavController({
			tree: this.tree,
			handle: () => this.session.handle,
			prompt: this.prompt,
			switchToTree: () => {
				if (this.viewMode !== 'tree') this.viewMode = 'tree';
			},
			setError,
		});

		this.nodeActions = createNodeActions({
			handle: () => this.session.handle,
			rows: () => this.tree.rows,
			selectedIndex: () => this.nav.selectedIndex,
			setSelectedPath: (p) => this.nav.select(p),
			siblingCount: (p) => this.tree.siblingCount(p),
			prompt: this.prompt,
			apply: (op) => this.session.applyOp(op),
			setError: (e) => {
				this.error = e;
			},
			flash: (msg) => this.flash(msg),
			onOpenInNewTab: (source) => deps.onOpenInNewTab(source),
			getCutMark: () => this.cutMark,
			setCutMark: (m) => {
				this.cutMark = m;
			},
		});

		this.menuAction = createDocMenuActions({
			edit: this.edit,
			nodeActions: this.nodeActions,
			apply: (op) => this.session.applyOp(op),
		});

		this.wireBackups();
		this.wireAutoSave();
	}

	flash = (msg: string) => {
		this.saveFlash = msg;
		setTimeout(() => (this.saveFlash = null), SAVE_FLASH_MS);
	};

	switchView = async (mode: ViewMode) => {
		const api = this.deps.code.api();
		if (this.viewMode === 'code' && mode !== 'code' && this.deps.code.dirty() && api) {
			if (!(await api.flush())) return;
		}
		this.viewMode = mode;
	};

	dispose = () => {
		this.session.dispose();
	};

	private wireBackups() {
		const backup = createBackupFlusher({
			handle: () => this.session.handle,
			sourceName: () => this.session.sourceName,
			isDirty: () => this.isDirty,
			codeDirty: () => this.deps.code.dirty(),
			flushCodeBuffer: () => this.deps.code.api()?.flush() ?? Promise.resolve(true),
		});

		$effect(() => {
			const h = this.session.handle;
			void this.session.summary?.version;
			void this.deps.code.dirty();
			if (!h || !this.isDirty) return;
			if (this.backupTimer) clearTimeout(this.backupTimer);
			this.backupTimer = setTimeout(() => void backup.flush(), BACKUP_IDLE_MS);
			return () => {
				if (this.backupTimer) clearTimeout(this.backupTimer);
			};
		});

		let prevActive = false;
		$effect(() => {
			const nowActive = this.deps.isActive();
			if (prevActive && !nowActive && this.isDirty) void backup.flush();
			prevActive = nowActive;
		});

		$effect(() => {
			const onBlur = () => {
				if (this.isDirty) void backup.flush();
			};
			window.addEventListener('blur', onBlur);
			return () => window.removeEventListener('blur', onBlur);
		});
	}

	private wireAutoSave() {
		const autoSaver = createAutoSaver({
			isDirty: () => this.isDirty,
			isFileBacked: () => this.session.summary?.fileBacked ?? false,
			autoSaveOnIdle: () => behaviorPrefs.autoSaveOnIdle,
			autoSaveIdleMs: () => behaviorPrefs.autoSaveIdleMs,
			save: (opts) => this.session.save(opts),
		});
		$effect(() => {
			void this.session.summary?.version;
			void this.deps.code.dirty();
			void this.isDirty;
			void behaviorPrefs.autoSaveOnIdle;
			void behaviorPrefs.autoSaveIdleMs;
			return autoSaver.schedule();
		});
	}
}
