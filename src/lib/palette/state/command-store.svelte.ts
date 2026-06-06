import { untrack } from 'svelte';
import { PersistedStore } from '$lib/util/persisted-store.svelte';

export type CommandCategory =
	| 'Tab'
	| 'View'
	| 'Document'
	| 'Generate'
	| 'Compare'
	| 'Navigate'
	| 'Import / Export'
	| 'Help';

export interface Command {
	id: string;
	label: string;
	category: CommandCategory;

	keybinding?: string;

	enabled?: () => boolean;
	run: () => void | Promise<void>;
}

class CommandRegistry {
	list: Command[] = $state([]);

	register(cmd: Command): () => void {
		const next = untrack(() => [...this.list.filter((c) => c.id !== cmd.id), cmd]);
		this.list = next;
		return () => {
			this.list = untrack(() => this.list.filter((c) => c !== cmd));
		};
	}

	get(id: string): Command | undefined {
		return this.list.find((c) => c.id === id);
	}
}

export const commandRegistry = new CommandRegistry();

import { loadPersisted, savePersisted, COMMAND_USAGE_FILE } from '$lib/util/persist';

const USAGE_FILE = COMMAND_USAGE_FILE;
const USAGE_KEY = 'usage';

function sanitizeCounts(raw: unknown): Record<string, number> {
	if (typeof raw !== 'object' || raw === null) return {};
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === 'number') out[k] = v;
	}
	return out;
}

class UsageTracker extends PersistedStore {
	counts: Record<string, number> = $state({});

	protected async load(): Promise<void> {
		const raw = await loadPersisted<Record<string, number>>(USAGE_FILE, USAGE_KEY);
		this.counts = sanitizeCounts(raw);
	}

	bump(id: string): void {
		this.counts = { ...this.counts, [id]: (this.counts[id] ?? 0) + 1 };
		void savePersisted(USAGE_FILE, USAGE_KEY, this.counts);
	}

	topN(n: number, pool: string[]): string[] {
		return [...pool]
			.filter((id) => (this.counts[id] ?? 0) > 0)
			.sort((a, b) => (this.counts[b] ?? 0) - (this.counts[a] ?? 0))
			.slice(0, n);
	}
}

export const commandUsage = new UsageTracker();
