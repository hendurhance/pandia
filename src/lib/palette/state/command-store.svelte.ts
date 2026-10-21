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
	hidden?: boolean;

	enabled?: () => boolean;
	run: () => void | Promise<void>;
}

class CommandRegistry {
	list: Command[] = $state.raw([]);

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

	run(id: string): void {
		const cmd = this.get(id);
		if (cmd && (!cmd.enabled || cmd.enabled())) void cmd.run();
	}
}

export const commandRegistry = new CommandRegistry();

import { loadPersisted, savePersisted, COMMAND_USAGE_FILE } from '$lib/util/persist';

const USAGE_FILE = COMMAND_USAGE_FILE;
const USAGE_KEY = 'usage';
const MAX_RECENT = 20;

function sanitizeRecent(raw: unknown): string[] {
	return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

class UsageTracker extends PersistedStore {
	/** Command ids, most recently run first. */
	recent: string[] = $state([]);

	protected async load(): Promise<void> {
		const raw = await loadPersisted<string[]>(USAGE_FILE, USAGE_KEY);
		this.recent = sanitizeRecent(raw);
	}

	bump(id: string): void {
		this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
		void savePersisted(USAGE_FILE, USAGE_KEY, this.recent);
	}

	topN(n: number, pool: string[]): string[] {
		const available = new Set(pool);
		return this.recent.filter((id) => available.has(id)).slice(0, n);
	}
}

export const commandUsage = new UsageTracker();
