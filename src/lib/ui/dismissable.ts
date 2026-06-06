interface DismissableOptions {
	onDismiss: () => void;

	ignore?: HTMLElement | null;
}

export function dismissable(node: HTMLElement, options: DismissableOptions) {
	let opts = options;
	const onDown = (e: MouseEvent) => {
		const target = e.target as Node;
		if (node.contains(target)) return;
		if (opts.ignore?.contains(target)) return;
		opts.onDismiss();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			opts.onDismiss();
		}
	};
	const t = setTimeout(() => {
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
	}, 0);
	return {
		update(next: DismissableOptions) {
			opts = next;
		},
		destroy() {
			clearTimeout(t);
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		},
	};
}
