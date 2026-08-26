<script lang="ts">
	import { untrack } from 'svelte';
	import { docSummary } from '$lib/ipc/doc';
	import type { DiffKind, DocHandle, Path } from '$lib/ipc/types';
	import { isExpandable, rootRow } from '$lib/views/tree/logic/model';
	import { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
	import TreeView from '$lib/views/tree/components/TreeView.svelte';

	interface Props {
		handle: DocHandle;

		diff: Map<string, DiffKind>;

		activePath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;
	}
	let { handle, diff, activePath = null, onScrollerReady }: Props = $props();

	const tree = new TreeRowsController({
		handle: () => handle,
		summary: () => null,
		setError: () => {},
	});

	let scrollRequest = $state<{ idx: number; nonce: number } | null>(null);
	let scrollNonce = 0;
	async function revealActive(target: Path) {
		await tree.ensurePathVisible(target);
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
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
