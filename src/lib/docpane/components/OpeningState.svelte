<script lang="ts">
	import type { OpenProgress } from '$lib/ipc/bindings';
	import { describeOpening, fmtElapsed } from '../logic/open-progress';

	let { name, progress }: { name: string; progress: OpenProgress | null } = $props();

	const started = Date.now();
	let now = $state(started);
	$effect(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	const view = $derived(describeOpening(progress));
	const percent = $derived(Math.round(view.fraction * 100));
</script>

<div class="opening">
	<div class="inner">
		<span class="name" title={name}>{name}</span>
		<span class="step" role="status">{view.step}</span>
		<div
			class="bar"
			role="progressbar"
			aria-label="Opening {name}"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
		>
			<div class="fill" style:width="{percent}%"></div>
		</div>
		<span class="meta">
			{#if view.detail}{view.detail} ·
			{/if}{fmtElapsed(now - started)}
		</span>
	</div>
</div>

<style>
	.opening {
		flex: 1;
		display: grid;
		place-items: center;
		padding: var(--space-2xl) var(--space-md);
		animation: appear 160ms ease-out 300ms both;
	}
	.inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		width: 100%;
		max-width: 420px;
	}
	.name {
		font-size: var(--font-size-lg);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.step {
		color: var(--text-dim);
	}
	.bar {
		height: 4px;
		background: var(--bg-elev-2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 200ms ease-out;
	}
	.meta {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fill {
			transition: none;
		}
	}
</style>
