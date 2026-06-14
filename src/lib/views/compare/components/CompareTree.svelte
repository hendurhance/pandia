<script lang="ts">
	import { docSummary } from '$lib/ipc/doc';
	import type { DiffKind, DocHandle, Path } from '$lib/ipc/types';
	import { isExpandable, rootRow } from '$lib/views/tree/logic/model';
	import { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';

	interface Props {
		handle: DocHandle;

		diff: Map<string, DiffKind>;

		diffPaths: Path[];

		activePath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;
	}
	let { handle, diff, diffPaths, activePath = null, onScrollerReady }: Props = $props();

	const tree = new TreeRowsController({
		handle: () => handle,
		summary: () => null,
		setError: () => {},
	});

	let scrollRequest = $state<{ idx: number; nonce: number } | null>(null);
	let scrollNonce = 0;
	$effect(() => {
		const target = activePath;
		if (!target) {
			scrollRequest = null;
			return;
		}
		void (async () => {
			await tree.ensurePathVisible(target);
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
			const idx = tree.contentRowIdx(target);
			if (idx >= 0) {
				scrollNonce++;
				scrollRequest = { idx, nonce: scrollNonce };
			}
		})();
	});

	$effect(() => {
		const h = handle;
		const paths = diffPaths;
		let cancelled = false;
		void (async () => {
			let sum;
			try {
				sum = await docSummary(h);
			} catch {
				return;
			}
			if (cancelled) return;
			const root = rootRow(sum.rootKind, sum.rootChildCount);
			tree.setRows([root]);
			if (isExpandable(root)) await tree.toggleAt(0);
			void paths;
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
