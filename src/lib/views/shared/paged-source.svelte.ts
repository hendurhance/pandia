export interface PagedFetchResult<T> {
	items: T[];
	total?: number;
}

export interface PagedSourceOptions<T> {
	pageSize: number;
	fetch: (start: number, end: number) => Promise<PagedFetchResult<T>>;
	onError: (e: unknown) => void;
	onReset?: () => void;
	debounceMs?: number;
}

export class PagedSource<T> {
	pages = $state.raw(new Map<number, T[]>());
	total: number | null = $state(null);
	fetching = $state(false);

	private inFlight = new Map<number, Promise<void>>();
	private generation = 0;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingRange: { lo: number; hi: number } | null = null;

	constructor(private opts: PagedSourceOptions<T>) {}

	pageStart = (i: number): number => Math.floor(i / this.opts.pageSize) * this.opts.pageSize;

	get = (i: number): T | undefined => {
		const start = this.pageStart(i);
		return this.pages.get(start)?.[i - start];
	};

	has = (i: number): boolean => this.get(i) !== undefined;

	ensureRange = async (lo: number, hi: number): Promise<void> => {
		const first = this.pageStart(Math.max(0, lo));
		const last = this.pageStart(Math.max(0, Math.max(lo, hi - 1)));
		const work: Promise<void>[] = [];
		for (let s = first; s <= last; s += this.opts.pageSize) {
			work.push(this.fetchPage(s));
		}
		await Promise.all(work);
	};

	ensureVisible = (lo: number, hi: number): void => {
		const ms = this.opts.debounceMs ?? 0;
		if (ms <= 0) {
			void this.ensureRange(lo, hi);
			return;
		}
		this.pendingRange = { lo, hi };
		if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			const range = this.pendingRange;
			this.pendingRange = null;
			if (range) void this.ensureRange(range.lo, range.hi);
		}, ms);
	};

	private fetchPage(start: number): Promise<void> {
		if (this.pages.has(start)) return Promise.resolve();
		const existing = this.inFlight.get(start);
		if (existing) return existing;

		const gen = this.generation;
		const work = (async () => {
			try {
				const result = await this.opts.fetch(start, start + this.opts.pageSize);

				if (gen !== this.generation) return;
				if (result.total !== undefined) this.total = result.total;
				const next = new Map(this.pages);
				next.set(start, result.items);
				this.pages = next;
			} catch (e) {
				if (gen !== this.generation) return;
				this.opts.onError(e);
			} finally {
				if (gen === this.generation) this.inFlight.delete(start);
			}
		})();
		this.inFlight.set(start, work);
		this.fetching = true;
		void work.finally(() => {
			if (this.inFlight.size === 0) this.fetching = false;
		});
		return work;
	}

	reset = (): void => {
		this.generation += 1;
		this.opts.onReset?.();
		if (this.debounceTimer != null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.pendingRange = null;
		this.pages = new Map();
		this.inFlight.clear();
		this.total = null;
		this.fetching = false;
	};
}
