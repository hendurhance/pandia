import type { DocSessionController } from '../state/doc-session.svelte';

export const AUTO_SAVE_MIN_IDLE_MS = 250;

export interface AutoSaveDeps {
	isDirty: () => boolean;

	isFileBacked: () => boolean;

	autoSaveOnIdle: () => boolean;

	autoSaveIdleMs: () => number;

	save: DocSessionController['save'];
}

export interface AutoSaver {
	schedule(): () => void;
}

export function createAutoSaver(deps: AutoSaveDeps): AutoSaver {
	let timer: ReturnType<typeof setTimeout> | null = null;
	function cancel() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}
	return {
		schedule() {
			cancel();
			if (!deps.isDirty() || !deps.isFileBacked() || !deps.autoSaveOnIdle()) {
				return cancel;
			}
			const idle = Math.max(AUTO_SAVE_MIN_IDLE_MS, deps.autoSaveIdleMs());
			timer = setTimeout(() => {
				void deps.save({ silent: true });
			}, idle);
			return cancel;
		},
	};
}
