export type SyncSide = 'left' | 'right';

export interface SyncScrollOpts {
	enabled?: boolean;

	safetyMs?: number;
}

export interface SyncScrollPair {
	bind(side: SyncSide, el: HTMLElement): void;

	setEnabled(on: boolean): void;

	dispose(): void;
}

export function createSyncScrollPair(opts: SyncScrollOpts = {}): SyncScrollPair {
	const safetyMs = opts.safetyMs ?? 200;

	let enabled = opts.enabled ?? true;
	let leftScroller: HTMLElement | null = null;
	let rightScroller: HTMLElement | null = null;
	let leftCleanup: (() => void) | null = null;
	let rightCleanup: (() => void) | null = null;
	let suppressedSide: SyncSide | null = null;
	let suppressCount = 0;
	let suppressTimer: ReturnType<typeof setTimeout> | null = null;

	function onPaneScroll(source: SyncSide) {
		if (!enabled || !leftScroller || !rightScroller) return;

		if (suppressedSide === source && suppressCount > 0) {
			suppressCount--;
			if (suppressCount === 0) suppressedSide = null;
			return;
		}

		const from = source === 'left' ? leftScroller : rightScroller;
		const to = source === 'left' ? rightScroller : leftScroller;
		const fromMax = from.scrollHeight - from.clientHeight;
		const toMax = to.scrollHeight - to.clientHeight;
		if (fromMax <= 0 || toMax <= 0) return;
		const target = (from.scrollTop / fromMax) * toMax;

		if (Math.abs(to.scrollTop - target) < 0.5) return;

		const otherSide: SyncSide = source === 'left' ? 'right' : 'left';
		suppressedSide = otherSide;
		suppressCount++;
		to.scrollTop = target;

		if (suppressTimer != null) clearTimeout(suppressTimer);
		suppressTimer = setTimeout(() => {
			suppressedSide = null;
			suppressCount = 0;
			suppressTimer = null;
		}, safetyMs);
	}

	function bind(side: SyncSide, el: HTMLElement) {
		const handler = () => onPaneScroll(side);
		if (side === 'left') {
			leftCleanup?.();
			leftScroller = el;
			el.addEventListener('scroll', handler, { passive: true });
			leftCleanup = () => el.removeEventListener('scroll', handler);
		} else {
			rightCleanup?.();
			rightScroller = el;
			el.addEventListener('scroll', handler, { passive: true });
			rightCleanup = () => el.removeEventListener('scroll', handler);
		}
	}

	function dispose() {
		leftCleanup?.();
		rightCleanup?.();
		leftCleanup = null;
		rightCleanup = null;
		leftScroller = null;
		rightScroller = null;
		if (suppressTimer != null) {
			clearTimeout(suppressTimer);
			suppressTimer = null;
		}
		suppressedSide = null;
		suppressCount = 0;
	}

	return {
		bind,
		setEnabled(on) {
			enabled = on;
		},
		dispose,
	};
}
