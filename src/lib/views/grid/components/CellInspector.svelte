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
		gap: 0.5rem;
		padding: 0.25rem 0.6rem;
		border-bottom: 1px solid var(--rule);
		font-size: 11px;
	}
	.insp-loc {
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--label-tracking);
	}
	.insp-btn {
		background: transparent;
		border: 1px solid var(--rule);
		color: var(--text-dim);
		font-size: 11px;
		padding: 0.05rem 0.5rem;
		cursor: pointer;
	}
	.insp-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.insp-body {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0.5rem 0.7rem;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text);
	}
</style>
