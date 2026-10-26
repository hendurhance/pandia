<script lang="ts">
	import type { DocStatus } from '../logic/status';
	import { updateCheck } from '$lib/shell/state/update-check.svelte';
	import { whatsNew } from '$lib/shell/state/whats-new.svelte';
	import { shortcutLabel } from '$lib/shell/logic/shortcuts';
	import Icon from '$lib/ui/Icon.svelte';
	import { MessageSquarePlus } from '@lucide/svelte';

	interface Props {
		status: DocStatus | null;
		onPaletteOpen?: () => void;
		onFeedback?: () => void;
		onWhatsNew?: () => void;
	}

	let { status, onPaletteOpen, onFeedback, onWhatsNew }: Props = $props();
</script>

<div class="statusbar">
	{#if status?.editing}
		<div class="sb-cell editing"><span class="val">editing</span></div>
	{/if}
	{#if status}
		<div class="sb-cell path" title={status.pathDisplay ?? ''}>
			<span class="lbl">path</span>
			<span class="val">{status.pathDisplay ?? '—'}</span>
		</div>
		<div class="sb-cell">
			<span class="lbl">type</span>
			<span class="val">{status.kindDisplay ?? '—'}</span>
		</div>
		<div class="sb-cell">
			<span class="lbl">size</span>
			<span class="val">{status.sizeDisplay ?? '—'}</span>
			{#if status.lazy}<span class="kbd">lazy</span>{/if}
		</div>
		{#if status.rootCountDisplay}
			<div class="sb-cell">
				<span class="lbl">root</span>
				<span class="val">{status.rootCountDisplay}</span>
			</div>
		{/if}
		{#if status.validity}
			{@const v = status.validity}
			<div class="sb-cell" data-validity={v.ok ? 'valid' : 'invalid'}>
				{#if v.kind === 'buffer'}
					{#if v.ok}
						<span class="val dot ok">JSON valid</span>
					{:else}
						<span class="val dot bad" title={v.detail ?? ''}>JSON invalid</span>
					{/if}
				{:else if v.ok}
					<span class="val dot ok">Schema valid</span>
				{:else}
					<span class="val dot bad">{v.errors} Schema error{v.errors === 1 ? '' : 's'}</span>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="sb-cell"><span class="lbl">No document</span></div>
	{/if}

	<div class="sb-spacer"></div>

	{#if whatsNew.unseen.length > 0}
		<button
			class="sb-cell right update-cell"
			onclick={() => onWhatsNew?.()}
			title="See what changed in Pandia {whatsNew.running}"
		>
			<span class="val update-dot">what's new in {whatsNew.running}</span>
		</button>
	{/if}

	{#if updateCheck.availableVersion}
		<button
			class="sb-cell right update-cell"
			onclick={() => updateCheck.openDialog()}
			title="Pandia {updateCheck.availableVersion} is available — click to install"
		>
			<span class="val update-dot">update v{updateCheck.availableVersion}</span>
		</button>
	{/if}

	<button
		class="sb-cell right kbd-cell"
		onclick={() => onPaletteOpen?.()}
		disabled={!onPaletteOpen}
		title={`Command palette (${shortcutLabel('palette.toggle')})`}
	>
		<span class="kbd">{shortcutLabel('palette.toggle')}</span><span class="cmd">Commands</span>
	</button>

	{#if onFeedback}
		<button
			class="sb-cell right kbd-cell feedback-cell"
			onclick={() => onFeedback()}
			title="Share feedback or a suggestion"
		>
			<Icon icon={MessageSquarePlus} size="xs" /><span class="cmd">Feedback</span>
		</button>
	{/if}
</div>

<style>
	.statusbar {
		display: flex;
		align-items: stretch;
		height: var(--status-h);
		background: var(--bg);
		border-top: var(--rule-width) solid var(--rule);
		font-size: var(--font-size-xs);
		letter-spacing: 0.08em;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
	}

	.sb-cell {
		display: inline-flex;
		align-items: center;
		gap: var(--space-sm);
		padding: 0 var(--space-lg);
		border-right: var(--rule-width) solid var(--rule);
		min-width: 0;
	}

	.lbl {
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
	}
	.val {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sb-cell.path {
		max-width: 40ch;
	}
	.sb-cell.path .val {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dot.ok::before {
		content: '● ';
		color: var(--success);
	}
	.dot.bad {
		color: var(--danger);
	}
	.dot.bad::before {
		content: '● ';
		color: var(--danger);
	}

	.sb-cell.editing .val {
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}
	.sb-cell.editing .val::before {
		content: '● ';
		color: var(--accent);
		animation: sb-pulse 1.4s ease-in-out infinite;
	}
	@keyframes sb-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.kbd {
		padding: 0 var(--space-xs);
		color: var(--text-dim);
		border: var(--rule-width) solid var(--rule-2);
		font-size: var(--font-size-xs);
		letter-spacing: 0;
	}

	.sb-spacer {
		flex: 1;
	}

	.sb-cell.right {
		border-right: 0;
		border-left: var(--rule-width) solid var(--rule);
	}
	.kbd-cell {
		background: transparent;
		cursor: pointer;
		height: 100%;
		font: inherit;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.kbd-cell:hover {
		color: var(--text);
	}
	.kbd-cell:hover .kbd {
		color: var(--text);
		border-color: var(--text-dim);
	}
	.kbd-cell:disabled {
		cursor: default;
		color: var(--text-dim);
	}
	.cmd {
		text-transform: lowercase;
	}
	.feedback-cell {
		gap: var(--space-sm);
	}

	.update-cell {
		background: transparent;
		cursor: pointer;
		font: inherit;
		letter-spacing: 0.08em;
		color: var(--accent);
	}
	.update-cell:hover {
		background: var(--accent-soft);
	}
	.update-dot::before {
		content: '● ';
		color: var(--accent);
	}
</style>
