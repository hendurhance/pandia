import { untrack } from 'svelte';
import { ipc } from '$lib/ipc/client';
import { describeError } from '$lib/ipc/error-copy';
import type { DocHandle, SchemaValidationResult } from '$lib/ipc/bindings';
import {
	behaviorPrefs,
	SCHEMA_DEBOUNCE_IMMEDIATE,
	SCHEMA_DEBOUNCE_MANUAL,
} from '$lib/settings/state/behavior-prefs.svelte';
import type { SchemaFrom } from '../schema-ref';

export interface SchemaOrigin {
	from: SchemaFrom;
	ref: string;
	ignoredDocRef: string | null;
}

export type SchemaVerdict =
	| { kind: 'none' }
	| { kind: 'checking'; last: SchemaValidationResult | null }
	| { kind: 'stale'; last: SchemaValidationResult | null }
	| { kind: 'checked'; result: SchemaValidationResult }
	| { kind: 'problem'; message: string; retry?: () => Promise<void> };

export function lastResult(verdict: SchemaVerdict): SchemaValidationResult | null {
	switch (verdict.kind) {
		case 'checked':
			return verdict.result;
		case 'checking':
		case 'stale':
			return verdict.last;
		default:
			return null;
	}
}

export class SchemaSession {
	text = $state('');
	origin: SchemaOrigin | null = $state(null);
	verdict: SchemaVerdict = $state({ kind: 'none' });

	private doc: { handle: DocHandle; version: number } | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private seq = 0;

	documentChanged(handle: DocHandle, version: number): void {
		untrack(() => {
			const prev = this.doc;
			const changed = prev?.handle !== handle || prev.version !== version;
			this.doc = { handle, version };
			if (changed && this.verdict.kind !== 'none' && this.verdict.kind !== 'problem') {
				this.schedule();
			}
		});
	}

	setText(text: string): void {
		this.text = text;
		this.origin = null;
		this.schedule();
	}

	async load(text: string, origin: SchemaOrigin | null): Promise<void> {
		this.text = text;
		this.origin = origin;
		this.cancel();
		if (!text.trim()) {
			this.verdict = { kind: 'none' };
			return;
		}
		await behaviorPrefs.init();
		if (behaviorPrefs.schemaDebounceMs === SCHEMA_DEBOUNCE_MANUAL) {
			this.verdict = { kind: 'stale', last: null };
			return;
		}
		await this.validateNow();
	}

	fail(message: string, origin: SchemaOrigin | null, retry?: () => Promise<void>): void {
		this.cancel();
		this.text = '';
		this.origin = origin;
		this.verdict = { kind: 'problem', message, retry };
	}

	async validateNow(): Promise<void> {
		this.cancel();
		const text = this.text.trim();
		const doc = this.doc;
		if (!text || !doc) return;
		const mine = ++this.seq;
		this.verdict = { kind: 'checking', last: lastResult(this.verdict) };
		try {
			const result = await ipc.docValidateSchema(doc.handle, text);
			if (mine === this.seq) this.verdict = { kind: 'checked', result };
		} catch (e) {
			if (mine === this.seq) this.verdict = { kind: 'problem', message: describeError(e) };
		}
	}

	async settleVerdict(): Promise<SchemaVerdict> {
		if (this.verdict.kind === 'checking' || this.verdict.kind === 'stale') {
			await this.validateNow();
		}
		return this.verdict;
	}

	clear(): void {
		this.cancel();
		this.seq++;
		this.text = '';
		this.origin = null;
		this.verdict = { kind: 'none' };
	}

	dispose(): void {
		this.cancel();
		this.seq++;
	}

	private schedule(): void {
		this.cancel();
		const last = lastResult(this.verdict);
		if (!this.text.trim()) {
			this.verdict = { kind: 'none' };
			return;
		}
		const ms = behaviorPrefs.schemaDebounceMs;
		if (ms === SCHEMA_DEBOUNCE_MANUAL) {
			this.verdict = { kind: 'stale', last };
			return;
		}
		this.seq++;
		this.verdict = { kind: 'checking', last };
		if (ms === SCHEMA_DEBOUNCE_IMMEDIATE) {
			void this.validateNow();
			return;
		}
		this.timer = setTimeout(() => void this.validateNow(), ms);
	}

	private cancel(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}

class SchemaSessions {
	private byTab: Record<string, SchemaSession> = {};

	for(tabId: string): SchemaSession {
		return (this.byTab[tabId] ??= new SchemaSession());
	}

	existing(tabId: string): SchemaSession | null {
		return this.byTab[tabId] ?? null;
	}

	clear(tabId: string): void {
		this.byTab[tabId]?.dispose();
		delete this.byTab[tabId];
	}
}

export const schemaSessions = new SchemaSessions();
