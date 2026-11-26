<script lang="ts">
	import { untrack } from 'svelte';
	import { ipc } from '$lib/ipc/client';
	import type { DiffKind, DocHandle, Path } from '$lib/ipc/bindings';
	import { isExpandable } from '$lib/views/tree/logic/model';
	import { fetchRootRow, TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';

	interface Props {
		handle: DocHandle;
		version: number;

		diff: Map<string, DiffKind>;

		activePath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;
	}
	let { handle, version, diff, activePath = null, onScrollerReady }: Props = $props();

	const tree = new TreeRowsController({
		handle: () => handle,
		summary: () => null,
		setError: () => {},
	});

	let scrollRequest = $state<{ idx: number; nonce: number } | null>(null);
	let scrollNonce = 0;
	let revealGen = 0;
	async function revealActive(target: Path) {
		const gen = ++revealGen;
		await tree.ensurePathVisible(target);
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
		if (gen !== revealGen) return;
		const idx = tree.contentRowIdx(target);
		if (idx >= 0) {
			scrollNonce++;
			scrollRequest = { idx, nonce: scrollNonce };
		}
	}

	$effect(() => {
		const target = activePath;
		if (!target) {
			scrollRequest = null;
			return;
		}
		void untrack(() => revealActive(target));
	});

	$effect(() => {
		const h = handle;
		void version;
		let cancelled = false;
		void (async () => {
			let root;
			try {
				root = await fetchRootRow(h, await ipc.docSummary(h));
			} catch {
				return;
			}
			if (cancelled) return;
			tree.setRows([root]);
			if (isExpandable(root)) await tree.toggleAt(0);
			if (!cancelled && activePath) await revealActive(activePath);
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<TreeView
	rows={tree.rows}
	selectedIndex={-1}
	onToggle={tree.toggleAt}
	onSelect={() => {}}
	onVisibleRange={tree.onVisibleRange}
	onMaterializeGap={tree.materializeGap}
	onRowMenu={() => {}}
	{scrollRequest}
	editing={null}
	onEditInput={() => {}}
	onEditCommit={() => {}}
	onEditCancel={() => {}}
	readOnly
	diffHighlights={diff}
	{onScrollerReady}
/>
