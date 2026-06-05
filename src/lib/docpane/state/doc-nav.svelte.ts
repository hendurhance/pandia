import { docGetValue } from '$lib/ipc/doc';
import type { DocHandle, Path } from '$lib/ipc/types';
import { parsePath, pathToString } from '$lib/util/path';
import type { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import type { PromptController } from '$lib/ui/prompt.svelte';

export interface DocNavDeps {
	tree: TreeRowsController;
	handle: () => DocHandle | null;
	prompt: PromptController;
	switchToTree: () => void;
	setError: (msg: string | null) => void;
}

export class DocNavController {
	selectedPath: Path | null = $state(null);
	scrollRequest: { idx: number; nonce: number } | null = $state(null);
	private scrollNonce = 0;

	constructor(private deps: DocNavDeps) {}

	
	readonly selectedIndex = $derived.by(() => {
		void this.deps.tree.rows;
		return this.selectedPath === null ? -1 : this.deps.tree.contentRowIdx(this.selectedPath);
	});

	
	select = (path: Path | null) => {
		this.selectedPath = path;
	};

	
	selectRow = (index: number) => {
		const row = this.deps.tree.rows[index];
		if (row.variant !== 'content') return;
		this.selectedPath = row.path;
		this.deps.setError(null);
	};

	
	scrollTo = (path: Path) => {
		const idx = this.rowIndexOf(path);
		if (idx < 0) return;
		this.selectedPath = path;
		this.requestScroll(idx);
	};

	
	navigateTo = async (target: Path) => {
		this.deps.switchToTree();
		await this.deps.tree.ensurePathVisible(target);
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
		this.selectedPath = target;
		const idx = this.rowIndexOf(target);
		if (idx >= 0) this.requestScroll(idx);
	};

	
	onGraphPick = (path: Path) => {
		this.deps.switchToTree();
		this.selectedPath = path;
		const idx = this.rowIndexOf(path);
		if (idx >= 0) this.requestScroll(idx);
	};

	goToPath = async () => {
		const handle = this.deps.handle();
		if (!handle) return;
		const input = await this.deps.prompt.show('go to path (e.g. $.events[4].name):', '$');
		if (input === null) return;
		const parsed = parsePath(input);
		if (!parsed.ok) {
			this.deps.setError(`invalid path: ${parsed.error}`);
			return;
		}
		if (parsed.path.length > 0) {
			try {
				await docGetValue(handle, parsed.path); // throws InvalidPath if absent
			} catch {
				this.deps.setError(`path not found: ${pathToString(parsed.path)}`);
				return;
			}
		}
		this.deps.setError(null);
		await this.navigateTo(parsed.path);
	};

	
	onSegment = (depth: number) => {
		if (this.selectedPath === null) {
			this.scrollTo([]);
			return;
		}
		this.scrollTo(depth < 0 ? [] : this.selectedPath.slice(0, depth + 1));
	};

	private rowIndexOf(path: Path): number {
		return this.deps.tree.contentRowIdx(path);
	}

	private requestScroll(idx: number) {
		this.scrollNonce += 1;
		this.scrollRequest = { idx, nonce: this.scrollNonce };
	}
}
