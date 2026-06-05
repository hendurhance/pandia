import type { DocHandle } from '$lib/ipc/types';

export type CompareTarget =
	| { kind: 'file' }
	| { kind: 'tab'; handle: DocHandle; sourceName: string | null };
