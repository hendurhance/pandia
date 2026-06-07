<script lang="ts">
	import { parseHeaders, URL_FETCH_TIMEOUT_MS } from '../logic/url-fetch';

	interface Props {
		busy: boolean;

		onLoad: (text: string, sourceName: string) => void;
	}

	let { busy, onLoad }: Props = $props();

	let urlText = $state('');
	let urlBusy = $state(false);
	let urlError: string | null = $state(null);
	let urlAbort: AbortController | null = null;
	let showHeaders = $state(false);
	let headersText = $state('');

	async function onFetchUrl() {
		const url = urlText.trim();
		if (!url) return;
		urlError = null;
		urlBusy = true;
		const ctrl = new AbortController();
		urlAbort = ctrl;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			ctrl.abort();
		}, URL_FETCH_TIMEOUT_MS);
		try {
			const headers = parseHeaders(headersText);
			const r = await fetch(url, { signal: ctrl.signal, headers });
			if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
			const text = await r.text();
			onLoad(text, url);
		} catch (e) {
			urlError =
				(e as Error).name === 'AbortError'
					? timedOut
						? `timed out after ${URL_FETCH_TIMEOUT_MS / 1000}s`
						: 'cancelled'
					: String(e);
		} finally {
			clearTimeout(timer);
			urlBusy = false;
			urlAbort = null;
		}
	}

	function cancelFetch() {
		urlAbort?.abort();
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
			disabled={busy || urlBusy}
			onkeydown={(e) => {
				if (e.key === 'Enter') onFetchUrl();
			}}
		/>
		{#if urlBusy}
			<button onclick={cancelFetch}>Cancel</button>
		{:else}
			<button onclick={onFetchUrl} disabled={busy || !urlText.trim()}>Fetch</button>
		{/if}
	</div>
	{#if showHeaders}
		<textarea
			class="headers"
			bind:value={headersText}
			placeholder={'Authorization: Bearer …\nX-Api-Key: …'}
			rows="3"
			spellcheck="false"
		></textarea>
	{/if}
	{#if urlError}
		<div class="err text-sm">{urlError}</div>
	{/if}
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.label-row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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
	.err {
		color: var(--accent);
		padding-top: 0.2rem;
	}
</style>
