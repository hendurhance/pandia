import { loadPersisted, savePersisted } from './persist';
import { isObject } from './guards';
import { PersistedStore } from './persisted-store.svelte';

export interface FieldSpec<T> {
	default: T;
	coerce?: (raw: unknown) => T | undefined;
}

export function field<T>(def: T, coerce?: (raw: unknown) => T | undefined): FieldSpec<T> {
	return { default: def, coerce };
}

export function boolField(def: boolean): FieldSpec<boolean> {
	return field(def, (r) => (typeof r === 'boolean' ? r : undefined));
}

export function intField(def: number, min: number, max: number): FieldSpec<number> {
	return field(def, (r) => {
		if (typeof r !== 'number' || !Number.isFinite(r)) return undefined;
		return Math.min(max, Math.max(min, Math.round(r)));
	});
}

export function enumField<T extends string>(def: T, values: readonly T[]): FieldSpec<T> {
	return field<T>(def, (r) => (values.includes(r as T) ? (r as T) : undefined));
}

type Schema = Record<string, FieldSpec<unknown>>;
type Values<S extends Schema> = { [K in keyof S]: S[K] extends FieldSpec<infer T> ? T : never };

export interface PrefsConfig<S extends Schema> {
	file: string;
	key: string;
	schema: S;
	normalize?: (values: Values<S>) => Values<S>;
}

export class PrefsCore<S extends Schema> extends PersistedStore {
	private values: Values<S>;

	constructor(private cfg: PrefsConfig<S>) {
		super();
		this.values = $state(this.sanitize(undefined));
	}

	private sanitize(raw: unknown): Values<S> {
		const out = {} as Values<S>;
		const src = isObject(raw) ? raw : {};
		for (const k of Object.keys(this.cfg.schema) as (keyof S)[]) {
			const spec = this.cfg.schema[k];
			if (!spec) continue;
			const coerced = spec.coerce?.(src[k as string]);
			out[k] = (coerced !== undefined ? coerced : spec.default) as Values<S>[typeof k];
		}
		return this.cfg.normalize ? this.cfg.normalize(out) : out;
	}

	protected async load(): Promise<void> {
		this.values = this.sanitize(await loadPersisted<unknown>(this.cfg.file, this.cfg.key));
	}

	valueOf<K extends keyof S>(key: K): Values<S>[K] {
		return this.values[key];
	}

	private unchanged(next: Values<S>): boolean {
		return (Object.keys(this.cfg.schema) as (keyof S)[]).every((k) =>
			sameValue(next[k], this.values[k]),
		);
	}

	async update(partial: Partial<Values<S>>): Promise<void> {
		const next = this.sanitize({ ...this.values, ...partial });
		if (this.unchanged(next)) return;
		this.values = next;
		await this.persistNow();
	}

	set<K extends keyof S>(key: K, value: Values<S>[K]): Promise<void> {
		return this.update({ [key]: value } as Partial<Values<S>>);
	}

	stage(partial: Partial<Values<S>>): boolean {
		const next = this.sanitize({ ...this.values, ...partial });
		if (this.unchanged(next)) return false;
		this.values = next;
		return true;
	}

	async persistNow(): Promise<void> {
		const snapshot = {} as Record<string, unknown>;
		for (const k of Object.keys(this.cfg.schema) as (keyof S)[]) {
			snapshot[k as string] = this.values[k];
		}
		await savePersisted(this.cfg.file, this.cfg.key, snapshot);
	}
}

function sameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function definePrefs<S extends Schema>(cfg: PrefsConfig<S>): PrefsCore<S> & Values<S> {
	const store = new PrefsCore(cfg);
	for (const k of Object.keys(cfg.schema)) {
		Object.defineProperty(store, k, {
			get: () => store.valueOf(k),
			enumerable: true,
			configurable: true,
		});
	}
	return store as PrefsCore<S> & Values<S>;
}
