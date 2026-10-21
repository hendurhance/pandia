import type { DocHandle } from '$lib/ipc/bindings';

export type CompareTarget =
	| { kind: 'file' }
	| { kind: 'path'; path: string }
	| { kind: 'tab'; handle: DocHandle; sourceName: string | null };
