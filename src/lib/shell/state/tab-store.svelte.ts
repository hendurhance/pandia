import { untrack } from 'svelte';
import { schemaStore } from '$lib/panels/state/schema-store.svelte';
import { statusEq, type DocStatus } from '$lib/shell/logic/status';
import type { DocHandle, OpenSource } from '$lib/ipc/types';

export interface TabMeta {
	id: string;
	label: string;
}

export interface DocContext {
	handle: DocHandle;
	version: number;
	sourceName: string | null;
	
	fileBacked: boolean;
	
	save: (opts?: { silent?: boolean }) => Promise<boolean>;
}

export const MAX_TABS = 10;

export class TabStore {
	tabs: TabMeta[] = $state([{ id: 'tab-1', label: 'untitled' }]);
	activeId = $state('tab-1');
	capWarning = $state(false);

	statuses: Record<string, DocStatus | null> = $state({});
	contexts: Record<string, DocContext | null> = $state({});
	pendingOpens: Record<string, OpenSource | null> = $state({});

	private idCounter = 1;

	activeStatus = $derived(this.statuses[this.activeId] ?? null);
	activeContext = $derived(this.contexts[this.activeId] ?? null);

	compareCandidates = $derived(
		this.tabs
			.filter((t) => t.id !== this.activeId && (this.contexts[t.id] ?? null) != null)
			.map((t) => ({ id: t.id, label: t.label, ctx: this.contexts[t.id]! })),
	);

	private newId(): string {
		this.idCounter += 1;
		return `tab-${this.idCounter}`;
	}

	private warnCap(): void {
		this.capWarning = true;
		setTimeout(() => (this.capWarning = false), 2500);
	}

	create = () => {
		if (this.tabs.length >= MAX_TABS) {
			this.warnCap();
			return;
		}
		const t: TabMeta = { id: this.newId(), label: 'untitled' };
		this.tabs = [...this.tabs, t];
		this.activeId = t.id;
	};

	close = (id: string) => {
		const idx = this.tabs.findIndex((t) => t.id === id);
		if (idx < 0) return;
		schemaStore.clear(id);
		const next = this.tabs.filter((t) => t.id !== id);
		if (next.length === 0) {
			const fresh: TabMeta = { id: this.newId(), label: 'untitled' };
			this.tabs = [fresh];
			this.activeId = fresh.id;
			return;
		}
		this.tabs = next;
		if (id === this.activeId) {
			this.activeId = next[Math.min(idx, next.length - 1)].id;
		}
	};

	activate = (id: string) => {
		this.activeId = id;
	};

	next = () => {
		const idx = this.tabs.findIndex((t) => t.id === this.activeId);
		if (idx < 0) return;
		this.activeId = this.tabs[(idx + 1) % this.tabs.length].id;
	};

	prev = () => {
		const idx = this.tabs.findIndex((t) => t.id === this.activeId);
		if (idx < 0) return;
		this.activeId = this.tabs[(idx - 1 + this.tabs.length) % this.tabs.length].id;
	};

	reorder = (sourceId: string, targetId: string) => {
		const sourceIdx = this.tabs.findIndex((t) => t.id === sourceId);
		const targetIdx = this.tabs.findIndex((t) => t.id === targetId);
		if (sourceIdx < 0 || targetIdx < 0) return;
		const next = [...this.tabs];
		const [moved] = next.splice(sourceIdx, 1);
		next.splice(targetIdx, 0, moved);
		this.tabs = next;
	};

	setLabel = (id: string, label: string) => {
		untrack(() => {
			const i = this.tabs.findIndex((t) => t.id === id);
			if (i < 0) return;
			if (this.tabs[i].label === label) return;
			this.tabs = this.tabs.map((t, idx) => (idx === i ? { ...t, label } : t));
		});
	};

	setStatus = (id: string, status: DocStatus | null) => {
		untrack(() => {
			if (statusEq(this.statuses[id] ?? null, status)) return;
			this.statuses = { ...this.statuses, [id]: status };
		});
	};

	setContext = (id: string, ctx: DocContext | null) => {
		untrack(() => {
			const prev = this.contexts[id] ?? null;
			if (
				prev === ctx ||
				(prev != null &&
					ctx != null &&
					prev.handle === ctx.handle &&
					prev.version === ctx.version &&
					prev.sourceName === ctx.sourceName &&
					prev.fileBacked === ctx.fileBacked)
			)
				return;
			this.contexts = { ...this.contexts, [id]: ctx };
		});
	};

	setPendingOpen = (id: string, source: OpenSource) => {
		this.pendingOpens = { ...this.pendingOpens, [id]: source };
	};

	clearPendingOpen = (id: string) => {
		if (this.pendingOpens[id] == null) return;
		this.pendingOpens = { ...this.pendingOpens, [id]: null };
	};

	isEmpty = (id: string): boolean => (this.statuses[id] ?? null) == null;

	
	openInTab = (source: OpenSource, opts: { focus?: boolean } = {}): boolean => {
		const focus = opts.focus ?? true;
		if (focus && this.isEmpty(this.activeId)) {
			this.setPendingOpen(this.activeId, source);
			return true;
		}
		if (this.tabs.length >= MAX_TABS) {
			this.warnCap();
			return false;
		}
		const t: TabMeta = { id: this.newId(), label: 'untitled' };
		this.tabs = [...this.tabs, t];
		if (focus) this.activeId = t.id;
		this.setPendingOpen(t.id, source);
		return true;
	};
}
