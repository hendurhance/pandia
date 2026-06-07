interface ResizableOptions {
	onMove: (dx: number) => void;
	onStart?: () => void;

	onEnd?: (moved: boolean) => void;

	swallow?: boolean;
}

export function resizable(node: HTMLElement, options: ResizableOptions) {
	let opts = options;
	let startX = 0;
	let moved = false;
	let active = false;

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		if (opts.swallow) {
			e.preventDefault();
			e.stopPropagation();
		}
		active = true;
		startX = e.clientX;
		moved = false;
		node.setPointerCapture(e.pointerId);
		opts.onStart?.();
	}
	function move(e: PointerEvent) {
		if (!active) return;
		const dx = e.clientX - startX;
		if (Math.abs(dx) > 1) moved = true;
		opts.onMove(dx);
	}
	function end(e: PointerEvent) {
		if (!active) return;
		active = false;
		try {
			node.releasePointerCapture(e.pointerId);
		} catch {}
		opts.onEnd?.(moved);
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', end);
	node.addEventListener('pointercancel', end);

	return {
		update(next: ResizableOptions) {
			opts = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', end);
			node.removeEventListener('pointercancel', end);
		},
	};
}
