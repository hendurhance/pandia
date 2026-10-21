<script lang="ts">
	import { inspectorText } from '../logic/grid-cell';

	let {
		value,
		location,
		copied,
		onCopy,
		onOpenInTree,
	}: {
		value: unknown;

		location: string;
		copied: boolean;
		onCopy: () => void;
		onOpenInTree: () => void;
	} = $props();
</script>

<div class="inspector">
	<div class="insp-head">
		<span class="insp-loc">{location}</span>
		<span class="grow"></span>
		<button class="insp-btn" onclick={onOpenInTree} title="Reveal this cell in the tree view"
			>Open in tree ↗</button
		>
		<button class="insp-btn" onclick={onCopy}>{copied ? 'Copied' : 'Copy'}</button>
	</div>
	<pre class="insp-body">{inspectorText(value)}</pre>
</div>

<style>
	.inspector {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		max-height: 30%;
		min-height: 0;
		border-top: 1px solid var(--rule-2);
		background: var(--bg-elev);
	}
	.insp-head {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		border-bottom: 1px solid var(--rule);
		font-size: var(--font-size-sm);
	}
	.insp-loc {
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--label-tracking);
	}
	.insp-btn {
		background: transparent;
		border: 1px solid var(--rule);
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		padding: 0.05rem var(--space-sm);
		cursor: pointer;
	}
	.insp-btn:hover {
		color: var(--text);
		border-color: var(--rule-2);
	}
	.insp-body {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: var(--space-sm);
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--font-size-base);
		line-height: 1.5;
		color: var(--text);
	}
</style>
