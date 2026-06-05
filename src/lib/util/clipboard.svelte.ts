export class CopyFlag {
	done = $state(false);
	private timer: ReturnType<typeof setTimeout> | null = null;

	
	async copy(text: string, ms = 1500): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			this.flash(ms);
			return true;
		} catch {
			return false;
		}
	}

	
	flash(ms = 1500): void {
		this.done = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.done = false), ms);
	}
}
