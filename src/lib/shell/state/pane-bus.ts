import type { Path } from '$lib/ipc/bindings';
import type { CompareTarget } from '$lib/views/compare/logic/compare-target';

export type PaneCommand =
	| { kind: 'navigate'; path: Path }
	| { kind: 'history'; delta: number }
	| { kind: 'compare'; target: CompareTarget };

export class PaneCommandBus {
	private handlers = new Map<string, (cmd: PaneCommand) => void>();

	subscribe(tabId: string, handler: (cmd: PaneCommand) => void): () => void {
		this.handlers.set(tabId, handler);
		return () => {
			if (this.handlers.get(tabId) === handler) this.handlers.delete(tabId);
		};
	}

	dispatch(tabId: string, cmd: PaneCommand): void {
		this.handlers.get(tabId)?.(cmd);
	}
}
