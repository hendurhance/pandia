import type { OpenPhase, OpenProgress } from '$lib/ipc/bindings';
import { fmtBytes } from '$lib/util/format';

const PHASE_LABEL: Record<OpenPhase, string> = {
	reading: 'Reading the file',
	checking: 'Checking the JSON',
};

export interface OpeningView {
	step: string;
	detail: string;
	fraction: number;
}

export function describeOpening(progress: OpenProgress | null): OpeningView {
	if (!progress) return { step: 'Opening', detail: '', fraction: 0 };
	return {
		step: PHASE_LABEL[progress.phase],
		detail: `${fmtBytes(progress.done)} of ${fmtBytes(progress.total)}`,
		fraction: progress.done / progress.total,
	};
}

export function fmtElapsed(ms: number): string {
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs} s`;
	return `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`;
}
