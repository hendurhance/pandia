import type { ContentRow } from './model';

export function editSize(s: string): number {
	return Math.min(Math.max(s.length + 1, 4), 60);
}

export function valueTypeLabel(k: ContentRow['kind']): string {
	switch (k) {
		case 'string':
			return 'Str';
		case 'number':
			return 'Num';
		case 'bool':
			return 'Bool';
		case 'null':
			return 'Null';
		case 'object':
		case 'array':
			return 'Val';
	}
}

export function nextNumberValue(buffer: string, delta: number): string {
	const cur = parseFloat(buffer);
	const base = Number.isFinite(cur) ? cur : 0;
	const next = Math.round((base + delta) * 1e9) / 1e9;
	return String(next);
}

export interface EditCallbacks {
	onCommit: () => void;
	onCancel: () => void;
	onInput: (value: string) => void;
}

export interface EditDeps extends EditCallbacks {
	
	buffer: () => string;
}

export function createEditHandlers(deps: EditDeps) {
	
	function onAreaKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			e.stopPropagation();
			deps.onCommit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			deps.onCancel();
		} else {
			e.stopPropagation();
		}
	}

	
	function commitBool(value: 'true' | 'false') {
		deps.onInput(value);
		deps.onCommit();
	}

	
	function onBoolFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as Node | null;
		if (next && (e.currentTarget as HTMLElement).contains(next)) return;
		deps.onCommit();
	}

	function onBoolKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			e.stopPropagation();
			deps.onInput(deps.buffer() === 'true' ? 'false' : 'true');
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			deps.onCommit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			deps.onCancel();
		} else {
			e.stopPropagation();
		}
	}

	function onNumberKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			deps.onInput(nextNumberValue(deps.buffer(), e.shiftKey ? 10 : 1));
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			deps.onInput(nextNumberValue(deps.buffer(), e.shiftKey ? -10 : -1));
		} else {
			onEditKeydown(e);
		}
	}

	function onEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			deps.onCommit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			deps.onCancel();
		} else {
			e.stopPropagation();
		}
	}

	return {
		onAreaKeydown,
		commitBool,
		onBoolFocusOut,
		onBoolKeydown,
		onNumberKeydown,
		onEditKeydown,
	};
}
