import { flushSync } from 'svelte';

export function inRoot<T>(fn: () => T): { result: T; destroy: () => void } {
	let result!: T;
	const destroy = $effect.root(() => {
		result = fn();
	});
	flushSync();
	return { result, destroy };
}

export interface ReactiveBox<T> {
	value: T;
}

export function reactiveBox<T>(initial: T): ReactiveBox<T> {
	let value = $state(initial);
	return {
		get value() {
			return value;
		},
		set value(v: T) {
			value = v;
		},
	};
}
