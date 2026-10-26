<script lang="ts">
	import Popover from '$lib/ui/Popover.svelte';
	import { fmtBytes } from '$lib/util/format';
	import { imagePreview } from './image-preview.svelte';

	const CARD_W = 264;
	const CARD_H = 236;
	const GAP = 6;

	const s = $derived(imagePreview.state);

	const position = $derived.by(() => {
		if (s.phase === 'hidden') return { x: 0, y: 0 };
		const below = s.anchor.bottom + GAP;
		const fits = below + CARD_H <= window.innerHeight;
		return { x: s.anchor.left, y: fits ? below : s.anchor.top - CARD_H - GAP };
	});

	let size: { w: number; h: number } | null = $state(null);
	let broken = $state(false);

	$effect(() => {
		void (s.phase === 'ready' ? s.image.src : null);
		size = null;
		broken = false;
	});

	function typeLabel(type: string): string {
		const sub = type.replace('image/', '').replace('+xml', '');
		return (sub === 'x-icon' || sub === 'vnd.microsoft.icon' ? 'ico' : sub).toUpperCase();
	}
</script>

{#if s.phase !== 'hidden'}
	<Popover x={position.x} y={position.y} width={CARD_W} height={CARD_H} onClose={imagePreview.hide}>
		<div
			class="card"
			role="group"
			aria-label="image preview"
			onpointerenter={imagePreview.keepOpen}
			onpointerleave={imagePreview.hoverEnd}
		>
			{#if s.phase === 'ask'}
				<div class="ask">
					<div class="text-sm">Image on <strong>{s.host}</strong></div>
					<div class="dim text-xs">Loading the preview contacts that server.</div>
					<div class="actions">
						<button class="btn btn-primary" onclick={imagePreview.load}>Load preview</button>
						<button class="btn btn-ghost" onclick={imagePreview.alwaysLoad}>
							Always load web images
						</button>
					</div>
					<div class="dim text-xs">You can change this in Settings → Behavior.</div>
				</div>
			{:else}
				<div class="frame" class:checker={s.phase === 'ready' && !broken}>
					{#if s.phase === 'ready' && !broken}
						<img
							src={s.image.src}
							alt="preview"
							onload={(e) => {
								const img = e.currentTarget as HTMLImageElement;
								size = { w: img.naturalWidth, h: img.naturalHeight };
							}}
							onerror={() => (broken = true)}
						/>
					{:else}
						<span class="note dim text-xs">
							{#if s.phase === 'loading'}
								Loading…
							{:else if s.phase === 'error'}
								{s.message}
							{:else}
								Pandia couldn't display this image.
							{/if}
						</span>
					{/if}
				</div>
				{#if s.phase === 'ready' && !broken}
					<div class="meta dim text-xs">
						{#if size}{size.w} × {size.h} ·
						{/if}{typeLabel(s.image.type)} · {fmtBytes(s.image.bytes)}
					</div>
				{/if}
			{/if}
		</div>
	</Popover>
{/if}

<style>
	.card {
		width: 264px;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-sm);
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule-2);
		box-shadow: var(--shadow-pop);
	}
	.frame {
		height: 180px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elev-2);
		overflow: hidden;
	}
	.frame.checker {
		background-color: var(--bg-elev-2);
		background-image:
			linear-gradient(45deg, var(--bg-elev-3) 25%, transparent 25%),
			linear-gradient(-45deg, var(--bg-elev-3) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--bg-elev-3) 75%),
			linear-gradient(-45deg, transparent 75%, var(--bg-elev-3) 75%);
		background-size: 12px 12px;
		background-position:
			0 0,
			0 6px,
			6px -6px,
			-6px 0;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.note {
		padding: var(--space-md);
		text-align: center;
	}
	.meta {
		font-variant-numeric: tabular-nums;
	}
	.ask {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
		margin-top: var(--space-xs);
	}
</style>
