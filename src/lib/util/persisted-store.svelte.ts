export abstract class PersistedStore {
	loaded = $state(false);
	private initPromise: Promise<void> | null = null;

	
	protected abstract load(): Promise<void>;

	
	protected onReady(): void {}

	async init(): Promise<void> {
		if (this.loaded) {
			this.onReady();
			return;
		}
		this.initPromise ??= (async () => {
			await this.load();
			this.onReady();
			this.loaded = true;
		})();
		await this.initPromise;
	}

	
	async reload(): Promise<void> {
		await this.load();
		this.onReady();
		this.loaded = true;
	}
}
