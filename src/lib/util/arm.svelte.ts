export const ARM_MS = 3000;

export class Arm {
	armed = $state(false);
	private timer: ReturnType<typeof setTimeout> | null = null;

	press(action: () => void, ms = ARM_MS): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.armed) {
			this.armed = false;
			action();
			return;
		}
		this.armed = true;
		this.timer = setTimeout(() => (this.armed = false), ms);
	}
}
