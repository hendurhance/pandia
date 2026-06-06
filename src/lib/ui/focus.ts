export function autofocusSelect(node: HTMLInputElement) {
	const t = setTimeout(() => {
		node.focus();
		node.select();
	}, 0);
	return { destroy: () => clearTimeout(t) };
}

export function autogrowArea(node: HTMLTextAreaElement) {
	const fit = () => {
		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	};
	fit();
	node.addEventListener('input', fit);
	const t = setTimeout(() => {
		node.focus();
		node.select();
		fit();
	}, 0);
	return {
		destroy: () => {
			node.removeEventListener('input', fit);
			clearTimeout(t);
		},
	};
}

export function autofocusEl(node: HTMLElement) {
	const t = setTimeout(() => node.focus(), 0);
	return { destroy: () => clearTimeout(t) };
}
