import { untrack } from 'svelte';
import {
	buildOffsets,
	captureScrollAnchor,
	fixedWindow,
	visibleWindow,
	OVERSCAN,
} from './scroll-math';

export interface WindowedScrollerOptions {
	rowCount: () => number;
	rowHeight: number;
	overscan?: number;

	heightAt?: (i: number) => number;
	heightsVersion?: () => number;

	keyAt?: (i: number) => string;

	onWidthChange?: (width: number, prev: number) => void;
}

export class WindowedScroller {
	scrollTop = $state(0);
	scrollLeft = $state(0);
	viewportHeight = $state(0);
	viewportWidth = $state(0);
	el: HTMLElement | undefined = $state.raw(undefined);

	private opts: WindowedScrollerOptions;
	private overscan: number;
	private bufBox: { current: Float64Array } = { current: new Float64Array(0) };
	private anchor: { key: string; index: number; delta: number } | null = null;
	private prevRowCount = 0;

	constructor(opts: WindowedScrollerOptions) {
		this.opts = opts;
		this.overscan = opts.overscan ?? OVERSCAN;

		$effect(() => {
			if (this.variable) void this.offsets;
			const count = this.opts.rowCount();
			untrack(() => {
				const wasEmpty = this.prevRowCount === 0;
				this.prevRowCount = count;
				const el = this.el;
				if (!el) return;

				if (wasEmpty && count > 0) {
					el.scrollTop = 0;
					this.scrollTop = 0;
					return;
				}

				const a = this.anchor;
				if (!a || count === 0) return;
				let idx = a.index < count && this.keyOf(a.index) === a.key ? a.index : -1;
				if (idx < 0 && this.opts.keyAt) {
					for (let i = 0; i < count; i++) {
						if (this.keyOf(i) === a.key) {
							idx = i;
							break;
						}
					}
				}
				if (idx < 0) return;
				const top = Math.max(0, this.offsetAt(idx) - a.delta);
				if (Math.abs(top - this.scrollTop) < 1) return;
				el.scrollTop = top;
				this.scrollTop = top;
			});
		});

		$effect(() => {
			if (this.variable) void this.offsets;
			const count = this.opts.rowCount();
			void this.scrollTop;
			untrack(() => {
				this.anchor = this.captureNow(count);
			});
		});
	}

	private get variable(): boolean {
		return this.opts.heightAt !== undefined;
	}

	private keyOf(i: number): string {
		return this.opts.keyAt ? this.opts.keyAt(i) : String(i);
	}

	private captureNow(count: number): { key: string; index: number; delta: number } | null {
		if (count <= 0) return null;
		if (this.variable) {
			const a = captureScrollAnchor(this.offsets, count, this.scrollTop);
			return a ? { key: this.keyOf(a.index), index: a.index, delta: a.delta } : null;
		}
		const h = this.opts.rowHeight;
		let i = Math.ceil(this.scrollTop / h);
		if (i > count - 1) i = count - 1;
		return { key: this.keyOf(i), index: i, delta: i * h - this.scrollTop };
	}

	readonly offsets = $derived.by(() => {
		const count = this.opts.rowCount();
		const heightAt = this.opts.heightAt;
		if (!heightAt) return this.bufBox.current.subarray(0, 0);
		void this.opts.heightsVersion?.();
		const result = buildOffsets(count, heightAt, this.bufBox.current);
		this.bufBox.current = result.buf;
		return result.view;
	});

	readonly totalHeight = $derived.by(() => {
		const count = this.opts.rowCount();
		if (!this.variable) return count * this.opts.rowHeight;
		return this.offsets[count] ?? 0;
	});

	readonly window = $derived.by(() => {
		const count = this.opts.rowCount();
		if (!this.variable) {
			return fixedWindow(
				this.scrollTop,
				this.viewportHeight,
				count,
				this.opts.rowHeight,
				this.overscan,
			);
		}
		return visibleWindow(this.offsets, count, this.scrollTop, this.viewportHeight, this.overscan);
	});

	offsetAt = (i: number): number => {
		if (!this.variable) return i * this.opts.rowHeight;
		return this.offsets[i] ?? 0;
	};

	/**
	 * Svelte action: wire the scroll element. Owns the scroll listener and a
	 * rAF-coalesced ResizeObserver (the forced-layout fix, applied once for
	 * every view).
	 */
	attach = (el: HTMLElement): { destroy: () => void } => {
		this.el = el;
		const sync = () => {
			this.viewportHeight = el.clientHeight;
			const w = el.clientWidth;
			if (w !== this.viewportWidth) {
				const prev = this.viewportWidth;
				this.viewportWidth = w;
				if (prev > 0 && Math.abs(w - prev) >= 4) this.opts.onWidthChange?.(w, prev);
			}
		};
		sync();

		const onScroll = () => {
			this.scrollTop = el.scrollTop;
			this.scrollLeft = el.scrollLeft;
		};
		el.addEventListener('scroll', onScroll, { passive: true });

		let rafId = 0;
		const ro = new ResizeObserver(() => {
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				sync();
			});
		});
		ro.observe(el);

		return {
			destroy: () => {
				if (rafId) cancelAnimationFrame(rafId);
				ro.disconnect();
				el.removeEventListener('scroll', onScroll);
				if (this.el === el) this.el = undefined;
			},
		};
	};

	scrollToIndex = (
		i: number,
		opts: { align?: 'center' | 'quarter'; behavior?: ScrollBehavior } = {},
	) => {
		const el = this.el;
		if (!el) return;
		const target = this.offsetAt(i);
		const lead =
			opts.align === 'center'
				? Math.max(0, this.viewportHeight / 2 - this.opts.rowHeight / 2)
				: Math.max(0, this.viewportHeight * 0.25);
		el.scrollTo({ top: Math.max(0, target - lead), behavior: opts.behavior ?? 'smooth' });
	};

	resetTop = () => {
		this.anchor = null;
		if (this.el) {
			this.el.scrollTop = 0;
			this.el.scrollLeft = 0;
		}
		this.scrollTop = 0;
		this.scrollLeft = 0;
	};
}
