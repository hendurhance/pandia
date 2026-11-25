import type { CanonicalRange, Path } from '$lib/ipc/bindings';
import { pathKey } from '$lib/views/tree/logic/model';

export class OffsetCache {
	private readonly ranges = new Map<string, CanonicalRange>();
	private readonly loading = new Set<string>();
	private generation = 0;

	get(path: Path): CanonicalRange | undefined {
		return this.ranges.get(pathKey(path));
	}

	missing(paths: Iterable<Path>): Path[] {
		const out: Path[] = [];
		const picked = new Set<string>();
		for (const p of paths) {
			const k = pathKey(p);
			if (this.ranges.has(k) || this.loading.has(k) || picked.has(k)) continue;
			picked.add(k);
			out.push(p);
		}
		return out;
	}

	async load(
		paths: Path[],
		fetch: (paths: Path[]) => Promise<(CanonicalRange | null)[]>,
		keep: () => boolean,
	): Promise<boolean> {
		const gen = this.generation;
		const keys = paths.map(pathKey);
		for (const k of keys) this.loading.add(k);
		try {
			const found = await fetch(paths);
			if (gen !== this.generation || !keep()) return false;
			keys.forEach((k, i) => {
				const r = found[i];
				if (r) this.ranges.set(k, r);
			});
			return true;
		} finally {
			if (gen === this.generation) for (const k of keys) this.loading.delete(k);
		}
	}

	clear(): void {
		this.generation += 1;
		this.ranges.clear();
		this.loading.clear();
	}
}
