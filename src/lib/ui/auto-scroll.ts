
export function edgeStep(depthIntoEdge: number, edgeZone: number, maxStep: number): number {
	return Math.min(maxStep, Math.max(2, (depthIntoEdge / edgeZone) * maxStep));
}

export interface AutoScrollOpts {
	
	scroller: () => HTMLElement | undefined;
	
	axis: 'vertical' | 'horizontal';
	
	pointer: () => number;
	
	active: () => boolean;
	
	onTick?: () => void;
	
	edgeZone?: number;
	
	maxStep?: number;
}

export interface AutoScroller {
	
	start(): void;
	
	stop(): void;
}

export function createAutoScroller(opts: AutoScrollOpts): AutoScroller {
	const edgeZone = opts.edgeZone ?? 40;
	const maxStep = opts.maxStep ?? 16;
	let raf = 0;

	function tick() {
		raf = 0;
		const scroller = opts.scroller();
		if (!scroller || !opts.active()) return;
		const rect = scroller.getBoundingClientRect();
		const p = opts.pointer();
		let delta = 0;
		if (opts.axis === 'vertical') {
			if (p < rect.top + edgeZone) delta = -edgeStep(rect.top + edgeZone - p, edgeZone, maxStep);
			else if (p > rect.bottom - edgeZone) delta = edgeStep(p - (rect.bottom - edgeZone), edgeZone, maxStep);
			if (delta !== 0) scroller.scrollTop += delta;
		} else {
			if (p < rect.left + edgeZone) delta = -edgeStep(rect.left + edgeZone - p, edgeZone, maxStep);
			else if (p > rect.right - edgeZone) delta = edgeStep(p - (rect.right - edgeZone), edgeZone, maxStep);
			if (delta !== 0) scroller.scrollLeft += delta;
		}
		if (delta !== 0) opts.onTick?.();
		raf = requestAnimationFrame(tick);
	}

	return {
		start() {
			if (!raf) raf = requestAnimationFrame(tick);
		},
		stop() {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
		},
	};
}
