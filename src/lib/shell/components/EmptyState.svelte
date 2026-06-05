<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import type { DetectKind, OpenSource } from '$lib/ipc/types';
	import { docDetectAndConvert } from '$lib/ipc/doc';
	import { buildDemoSource } from '../logic/demo';
	import { stem } from '$lib/util/path';
	import { detectFormat, formatLabel } from '../logic/detect-format';
	import URLFetchBox from './URLFetchBox.svelte';
	import RecentsBlock from './RecentsBlock.svelte';

	interface Props {
		busy: boolean;
		onOpenSource: (source: OpenSource) => void;
	}

	let { busy, onOpenSource }: Props = $props();

	let pasteText = $state('');
	const detected = $derived(detectFormat(pasteText));
	const detectedLabel = $derived(formatLabel(detected));

	async function onPickFile() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: [{ name: 'JSON', extensions: ['json', 'jsonc', 'json5', 'geojson'] }],
		});
		if (typeof picked !== 'string') return;
		onOpenSource({ kind: 'file', path: picked });
	}

	
	async function openFromText(text: string, baseName: string) {
		try {
			const r = await docDetectAndConvert(text);
			const finalText = r.error == null ? r.json : text;
			onOpenSource({ kind: 'text', text: finalText, name: renameForDetect(baseName, r.kind) });
		} catch {
			onOpenSource({ kind: 'text', text, name: baseName });
		}
	}

	function renameForDetect(base: string, kind: DetectKind): string {
		if (kind === 'json' || kind === 'unknown') return base;
		return `${stem(base)}.json`;
	}

	function onPasteCapture(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text');
		if (text && text.trim()) {
			e.preventDefault();
			void openFromText(text.trim(), 'pasted.json');
		}
	}

	function onPasteKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			const t = pasteText.trim();
			if (t) void openFromText(t, 'pasted.json');
		}
	}

	function onLoadDemo() {
		onOpenSource(buildDemoSource());
	}

	function onClickRecent(path: string) {
		onOpenSource({ kind: 'file', path });
	}
</script>

<div class="empty">
	<div class="inner">
		<header class="brand">
			<span class="title">PANDIA</span>
		</header>

		
		<section class="block">
			<div class="paste-wrap">
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					class="paste"
					bind:value={pasteText}
					onpaste={onPasteCapture}
					onkeydown={onPasteKeydown}
					placeholder={'Paste JSON · YAML · XML · CSV · cURL — loads instantly'}
					rows="5"
					disabled={busy}
					spellcheck="false"
					autofocus
				></textarea>
				{#if detectedLabel}
					<span class="detect-chip" title="Auto-detected format" aria-live="polite">
						{detectedLabel}
					</span>
				{/if}
			</div>
			<div class="row dim text-sm">
				<button class="link" onclick={onPickFile} disabled={busy}>pick a file…</button>
				<span>· or drop one anywhere · ⌘⏎ to load typed text</span>
			</div>
		</section>

		<RecentsBlock {busy} onPick={onClickRecent} />

		<URLFetchBox {busy} onLoad={openFromText} />

		<div class="demo-row">
			<button class="link dim text-sm" onclick={onLoadDemo} disabled={busy}>load demo data</button>
		</div>
	</div>
</div>

<style>
	.empty {
		flex: 1;
		display: grid;
		place-items: start center;
		overflow-y: auto;
		padding: 2.5rem 1rem 4rem;
	}
	.inner {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		width: 100%;
		max-width: 560px;
	}

	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
	}
	.title {
		font-size: 18px;
		letter-spacing: var(--label-tracking);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
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
	.link:disabled {
		color: var(--text-faint);
		cursor: default;
	}

	.paste-wrap {
		position: relative;
	}
	.paste {
		min-height: 120px;
		resize: vertical;
	}
	
	.detect-chip {
		position: absolute;
		top: 6px;
		right: 8px;
		padding: 1px 6px;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-soft);
		border: 1px solid var(--accent-line);
		border-radius: 3px;
		pointer-events: none;
	}

	.demo-row {
		display: flex;
		justify-content: center;
		padding-top: 0.4rem;
	}
</style>
