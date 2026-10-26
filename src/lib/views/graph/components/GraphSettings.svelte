<script lang="ts">
	import { dismissable } from '$lib/ui/dismissable';
	import type { EdgeStyle } from '../logic/render';

	interface Props {
		open: boolean;
		edgeStyle: EdgeStyle;
		animateExpand: boolean;
		onEdgeStyle: (s: EdgeStyle) => void;
		onAnimateExpand: (v: boolean) => void;
		onClose: () => void;

		anchor?: HTMLElement | null;
	}

	let { open, edgeStyle, animateExpand, onEdgeStyle, onAnimateExpand, onClose, anchor }: Props =
		$props();
</script>

{#if open}
	<div
		class="settings"
		role="dialog"
		aria-label="graph settings"
		use:dismissable={{ onDismiss: onClose, ignore: anchor ?? null }}
	>
		<div class="field">
			<div class="label">edges</div>
			<div class="seg">
				<button
					class:active={edgeStyle === 'elbow'}
					onclick={() => onEdgeStyle('elbow')}
					title="Right-angle elbows">elbow</button
				>
				<button
					class:active={edgeStyle === 'curve'}
					onclick={() => onEdgeStyle('curve')}
					title="Smooth bezier curves">curve</button
				>
			</div>
		</div>
		<div class="field">
			<div class="label">expand</div>
			<button
				class="switch"
				role="switch"
				aria-checked={animateExpand}
				onclick={() => onAnimateExpand(!animateExpand)}
			>
				<span class="switch-knob"></span>
				<span class="switch-text">{animateExpand ? 'animated' : 'instant'}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.settings {
		position: absolute;
		bottom: 60px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		min-width: 200px;
		background: var(--bg-elev-2);
		border: 1px solid var(--rule-2);
		border-radius: 8px;
		box-shadow: var(--shadow-pop);
	}
	.field {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		justify-content: space-between;
	}
	.label {
		font-size: var(--font-size-xs);
		letter-spacing: var(--label-tracking);
		text-transform: uppercase;
		color: var(--text-dim);
	}
</style>
