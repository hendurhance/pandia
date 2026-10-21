import { untrack } from 'svelte';
import { stat } from '@tauri-apps/plugin-fs';
import { ipc } from '$lib/ipc/client';
import { schemaSessions } from '$lib/panels/state/schema-store.svelte';
import { behaviorPrefs } from '$lib/settings/state/behavior-prefs.svelte';
import type { DocStatus } from '$lib/shell/logic/status';
import { basename } from '$lib/util/path';
import type { DocHandle, OpenSource } from '$lib/ipc/bindings';
import type { Handoff } from './handoff';
import { loadOpenTabs, saveOpenTabs } from './tabs-restore';

export const MAX_TABS = 10;
export const LARGE_FILE_WARN_BYTES = 200 * 1024 * 1024;

export interface DocContext {
	handle: DocHandle;
	version: number;
	sourceName: string | null;
	fileBacked: boolean;
	save: (opts?: { silent?: boolean }) => Promise<boolean>;
}

export interface PaneView {
	readonly label: string;
	readonly sourceName: string | null;
	readonly status: DocStatus | null;
	readonly context: DocContext | null;
}

export interface WorkspacePrompts {
	confirmLargeFile: (name: string, bytes: number) => Promise<boolean>;
	confirmUnsaved: (names: string[]) => Promise<'save' | 'discard' | 'cancel'>;
}

export type OpenOutcome =
	| { kind: 'opened'; tabId: string }
	| { kind: 'declined' }
	| { kind: 'full' };

interface TabRecord {
	id: string;
	handoff: Handoff | null;
}

export class TabSlot {
	constructor(
		private readonly workspace: Workspace,
		readonly tabId: string,
	) {}

	register(view: PaneView): () => void {
		return this.workspace.register(this.tabId, view);
	}

	get handoff(): Handoff | null {
		return this.workspace.tabs.find((t) => t.id === this.tabId)?.handoff ?? null;
	}

	isHandleAlive(handle: DocHandle): boolean {
		return this.workspace.isHandleAlive(handle);
	}

	versionOf(handle: DocHandle): number | null {
		return this.workspace.versionOf(handle);
	}

	resolveUnsaved(): Promise<boolean> {
		return this.workspace.resolveUnsaved([this.tabId]);
	}
}

export class Workspace {
	tabs: TabRecord[] = $state([{ id: 'tab-1', handoff: null }]);
	activeId = $state('tab-1');
	capWarning = $state(false);
	pendingOpens: Record<string, OpenSource | null> = $state({});

	private views: Record<string, PaneView> = $state.raw({});
	private slots: Record<string, TabSlot> = {};
	private idCounter = 1;
	private restored = false;

	constructor(private readonly prompts: WorkspacePrompts) {}

	activeStatus = $derived(this.views[this.activeId]?.status ?? null);
	activeContext = $derived(this.views[this.activeId]?.context ?? null);

	tabList = $derived(
		this.tabs.map((t) => ({
			id: t.id,
			label: this.views[t.id]?.label ?? 'untitled',
			sourceName: this.views[t.id]?.sourceName ?? null,
		})),
	);

	statuses = $derived(
		Object.fromEntries(this.tabs.map((t) => [t.id, this.views[t.id]?.status ?? null])),
	);

	compareCandidates = $derived(
		this.tabList.flatMap((t) => {
			const ctx = this.views[t.id]?.context;
			return t.id !== this.activeId && ctx ? [{ id: t.id, label: t.label, ctx }] : [];
		}),
	);

	slot(tabId: string): TabSlot {
		return (this.slots[tabId] ??= new TabSlot(this, tabId));
	}

	register(tabId: string, view: PaneView): () => void {
		untrack(() => {
			this.views = { ...this.views, [tabId]: view };
		});
		return () =>
			untrack(() => {
				if (this.views[tabId] !== view) return;
				const { [tabId]: _, ...rest } = this.views;
				this.views = rest;
			});
	}

	isHandleAlive(handle: DocHandle): boolean {
		return Object.values(this.views).some((v) => v.context?.handle === handle);
	}

	versionOf(handle: DocHandle): number | null {
		return (
			Object.values(this.views).find((v) => v.context?.handle === handle)?.context?.version ?? null
		);
	}

	async open(
		source: OpenSource,
		opts: { focus?: boolean; handoff?: Handoff | null } = {},
	): Promise<OpenOutcome> {
		if (source.kind !== 'text' && !(await this.mayOpen(source.path))) return { kind: 'declined' };
		const focus = opts.focus ?? true;
		const handoff = opts.handoff ?? null;
		if (focus && this.reusable(this.activeId)) {
			this.tabs = this.tabs.map((t) => (t.id === this.activeId ? { ...t, handoff } : t));
			this.setPendingOpen(this.activeId, source);
			return { kind: 'opened', tabId: this.activeId };
		}
		if (this.tabs.length >= MAX_TABS) {
			this.warnCap();
			return { kind: 'full' };
		}
		const t: TabRecord = { id: this.newId(), handoff };
		this.tabs = [...this.tabs, t];
		if (focus) this.activeId = t.id;
		this.setPendingOpen(t.id, source);
		return { kind: 'opened', tabId: t.id };
	}

	clearPendingOpen = (id: string) => {
		if (this.pendingOpens[id] == null) return;
		this.pendingOpens = { ...this.pendingOpens, [id]: null };
	};

	close = async (id: string): Promise<boolean> => {
		const tab = this.tabs.find((t) => t.id === id);
		if (!tab) return false;
		if (!(await this.resolveUnsaved([id]))) return false;
		await tab.handoff?.settle(id);
		this.remove(id);
		return true;
	};

	async closeAll(): Promise<boolean> {
		if (!(await this.resolveUnsaved(this.tabs.map((t) => t.id)))) return false;
		await Promise.all(this.tabs.map((t) => t.handoff?.settle(t.id)));
		return true;
	}

	async restore(launch: Promise<void>): Promise<void> {
		if (this.restored) return;
		this.restored = true;
		await behaviorPrefs.init();
		if (!behaviorPrefs.restoreTabsOnLaunch) return;
		const [{ paths, activeIndex }] = await Promise.all([loadOpenTabs(), launch]);
		const launched =
			Object.values(this.views).some((v) => v.context) ||
			Object.values(this.pendingOpens).some(Boolean);
		if (paths.length === 0 || launched) return;
		const tabIds: (string | undefined)[] = [];
		for (const [i, path] of paths.entries()) {
			const outcome = await this.open({ kind: 'file', path }, { focus: i === 0 });
			if (outcome.kind === 'full') break;
			tabIds.push(outcome.kind === 'opened' ? outcome.tabId : undefined);
		}
		const active = tabIds[activeIndex];
		if (active) this.activeId = active;
	}

	async snapshot(): Promise<void> {
		if (!behaviorPrefs.restoreTabsOnLaunch) return;
		const paths: string[] = [];
		let activeIndex = -1;
		for (const t of this.tabs) {
			const ctx = this.views[t.id]?.context;
			if (!ctx?.fileBacked || !ctx.sourceName) continue;
			if (t.id === this.activeId) activeIndex = paths.length;
			paths.push(ctx.sourceName);
		}
		await saveOpenTabs(paths, activeIndex);
	}

	create = () => {
		if (this.tabs.length >= MAX_TABS) {
			this.warnCap();
			return;
		}
		const t: TabRecord = { id: this.newId(), handoff: null };
		this.tabs = [...this.tabs, t];
		this.activeId = t.id;
	};

	activate = (id: string) => {
		this.activeId = id;
	};

	next = () => this.step(1);
	prev = () => this.step(-1);

	reorder = (sourceId: string, targetId: string) => {
		const sourceIdx = this.tabs.findIndex((t) => t.id === sourceId);
		const targetIdx = this.tabs.findIndex((t) => t.id === targetId);
		if (sourceIdx < 0 || targetIdx < 0) return;
		const next = [...this.tabs];
		const [moved] = next.splice(sourceIdx, 1);
		if (!moved) return;
		next.splice(targetIdx, 0, moved);
		this.tabs = next;
	};

	private async mayOpen(path: string): Promise<boolean> {
		if (!behaviorPrefs.warnLargeFileOpen) return true;
		let bytes = 0;
		try {
			bytes = Number((await stat(path)).size ?? 0);
		} catch {
			return true; // the open itself reports a missing or unreadable file
		}
		return bytes < LARGE_FILE_WARN_BYTES || this.prompts.confirmLargeFile(basename(path), bytes);
	}

	async resolveUnsaved(ids: string[]): Promise<boolean> {
		let unsaved = ids.filter((id) => this.views[id]?.status?.dirty);
		if (behaviorPrefs.autoSaveOnIdle) {
			const left: string[] = [];
			for (const id of unsaved) {
				const ctx = this.views[id]?.context;
				if (!(ctx?.fileBacked && (await ctx.save({ silent: true })))) left.push(id);
			}
			unsaved = left;
		}
		const [only] = unsaved;
		if (only === undefined) return true;
		if (unsaved.length === 1) this.activate(only);
		const choice = await this.prompts.confirmUnsaved(unsaved.map((id) => this.nameOf(id)));
		if (choice === 'cancel') return false;
		for (const id of unsaved) {
			const ctx = this.views[id]?.context;
			if (!ctx) continue;
			if (choice === 'discard') {
				void ipc.docBackupClear(ctx.handle).catch(() => {});
				continue;
			}
			this.activate(id); // a Save As dialog should show which document it is for
			if (!(await ctx.save())) return false;
		}
		return true;
	}

	private nameOf(id: string): string {
		const view = this.views[id];
		return basename(view?.context?.sourceName ?? view?.label ?? 'untitled');
	}

	private remove(id: string): void {
		const idx = this.tabs.findIndex((t) => t.id === id);
		if (idx < 0) return;
		schemaSessions.clear(id);
		const { [id]: _, ...views } = this.views;
		this.views = views;
		delete this.slots[id];
		const { [id]: __, ...pending } = this.pendingOpens;
		this.pendingOpens = pending;
		const next = this.tabs.filter((t) => t.id !== id);
		if (next.length === 0) {
			const fresh: TabRecord = { id: this.newId(), handoff: null };
			this.tabs = [fresh];
			this.activeId = fresh.id;
			return;
		}
		this.tabs = next;
		if (id === this.activeId) {
			const nextActive = next[Math.min(idx, next.length - 1)];
			if (nextActive) this.activeId = nextActive.id;
		}
	}

	private isEmpty(id: string): boolean {
		return (this.views[id]?.status ?? null) == null;
	}

	private reusable(id: string): boolean {
		return (
			this.isEmpty(id) &&
			this.pendingOpens[id] == null &&
			!this.tabs.find((t) => t.id === id)?.handoff?.owes
		);
	}

	private setPendingOpen(id: string, source: OpenSource): void {
		this.pendingOpens = { ...this.pendingOpens, [id]: source };
	}

	private step(delta: number): void {
		const idx = this.tabs.findIndex((t) => t.id === this.activeId);
		if (idx < 0) return;
		const t = this.tabs[(idx + delta + this.tabs.length) % this.tabs.length];
		if (t) this.activeId = t.id;
	}

	private newId(): string {
		this.idCounter += 1;
		return `tab-${this.idCounter}`;
	}

	private warnCap(): void {
		this.capWarning = true;
		setTimeout(() => (this.capWarning = false), 2500);
	}
}
