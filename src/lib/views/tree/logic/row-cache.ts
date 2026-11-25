import type { Path } from '$lib/ipc/bindings';
import { pathKey, type Row } from './model';

export class PathIndex {
	private readonly index = new Map<string, number>();
	private stale = true;

	invalidate(): void {
		this.stale = true;
	}

	find(rows: readonly Row[], path: Path): number {
		if (this.stale) {
			this.index.clear();
			rows.forEach((r, i) => {
				if (r.variant === 'content') this.index.set(pathKey(r.path), i);
			});
			this.stale = false;
		}
		return this.index.get(pathKey(path)) ?? -1;
	}
}

export class RowHeights {
	private readonly tall = new Map<string, number>();

	constructor(private readonly base: number) {}

	get(key: string): number {
		return this.tall.get(key) ?? this.base;
	}

	record(key: string, measured: number): boolean {
		if (measured <= this.base + 1) return this.tall.delete(key);
		if (this.tall.get(key) === measured) return false;
		this.tall.set(key, measured);
		return true;
	}

	clear(): boolean {
		if (this.tall.size === 0) return false;
		this.tall.clear();
		return true;
	}
}
