<script lang="ts">
	import { ipc } from '$lib/ipc/client';
	import { urlFetchCommand } from '../logic/url-fetch';

	interface Props {
		busy: boolean;
		onSendRequest: (curl: string, jobId: string) => Promise<boolean>;
	}

	let { busy, onSendRequest }: Props = $props();

	let urlText = $state('');
	let sendingJob: string | null = $state(null);
	let showHeaders = $state(false);
	let headersText = $state('');
	const HEADERS_PLACEHOLDER = 'Authorization: Bearer …\nX-Api-Key: …';
	$effect(() => cancelFetch);

	async function onFetchUrl() {
		const url = urlText.trim();
		if (!url || sendingJob) return;
		const jobId = crypto.randomUUID();
		sendingJob = jobId;
		try {
			if (await onSendRequest(urlFetchCommand(url, headersText), jobId)) urlText = '';
		} finally {
			if (sendingJob === jobId) sendingJob = null;
		}
	}

	function cancelFetch() {
		if (sendingJob) void ipc.cancelJob(sendingJob).catch(() => {});
	}
</script>

<section class="block">
	<div class="label-row">
		<span class="label">fetch URL</span>
		<button class="link text-sm" onclick={() => (showHeaders = !showHeaders)}>
			{showHeaders ? '− headers' : '+ headers'}
		</button>
	</div>
	<div class="row url-row">
		<input
			bind:value={urlText}
			placeholder="https://api.example.com/data.json"
			disabled={busy || sendingJob !== null}
			onkeydown={(e) => {
				if (e.key === 'Enter') onFetchUrl();
			}}
		/>
		{#if sendingJob}
			<button class="btn" onclick={cancelFetch}>Cancel</button>
		{:else}
			<button class="btn btn-primary" onclick={onFetchUrl} disabled={busy || !urlText.trim()}
				>Fetch</button
			>
		{/if}
	</div>
	{#if showHeaders}
		<textarea
			class="headers"
			bind:value={headersText}
			placeholder={HEADERS_PLACEHOLDER}
			rows="3"
			spellcheck="false"
		></textarea>
	{/if}
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.label-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}
	.url-row {
		flex-wrap: nowrap;
	}
	.url-row input {
		flex: 1;
		min-width: 0;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-dim);
		text-decoration: underline dotted;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.link:hover:not(:disabled) {
		color: var(--accent);
	}
	.headers {
		font-size: var(--font-size-sm);
		min-height: 60px;
		resize: vertical;
	}
</style>
