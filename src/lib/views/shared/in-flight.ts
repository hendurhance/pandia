export class InFlight<K> {
	private readonly running = new Map<K, Promise<void>>();

	get size(): number {
		return this.running.size;
	}

	get(key: K): Promise<void> | undefined {
		return this.running.get(key);
	}

	run(key: K, start: () => Promise<void>): Promise<void> {
		const existing = this.running.get(key);
		if (existing) return existing;
		const work: Promise<void> = start().finally(() => {
			if (this.running.get(key) === work) this.running.delete(key);
		});
		this.running.set(key, work);
		return work;
	}

	clear(): void {
		this.running.clear();
	}
}
