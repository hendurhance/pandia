import type { DocHandle } from '$lib/ipc/bindings';

export type CompareTarget =
	| { kind: 'file' }
	| { kind: 'tab'; handle: DocHandle; sourceName: string | null };
