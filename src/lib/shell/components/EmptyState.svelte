<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import type { Diagnosis, OpenSource } from '$lib/ipc/bindings';
	import PasteDiagnostic from './PasteDiagnostic.svelte';
	import { buildDemoSource } from '../logic/demo';
	import { JSON_OPEN_FILTERS } from '$lib/util/file-types';
	import { fmtKbd } from '$lib/util/platform';
	import { detectFormat, formatLabel } from '../logic/detect-format';
	import URLFetchBox from './URLFetchBox.svelte';
	import RecentsBlock from './RecentsBlock.svelte';

	interface Props {
		busy: boolean;
		onOpenSource: (source: OpenSource) => Promise<boolean>;
		onOpenFile: (path: string) => void;
		diagnosis: Diagnosis | null;
		onFixDiagnosis: (text: string) => void;
		onDismissDiagnosis: () => void;
	}

	let { busy, onOpenSource, onOpenFile, diagnosis, onFixDiagnosis, onDismissDiagnosis }: Props =
		$props();

	let pasteText = $state('');
	const detected = $derived(detectFormat(pasteText));
	const detectedLabel = $derived(formatLabel(detected));

	async function onPickFile() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: JSON_OPEN_FILTERS,
		});
		if (typeof picked !== 'string') return;
		onOpenFile(picked);
	}

	async function openFromText(text: string, baseName: string) {
		if (await onOpenSource({ kind: 'text', text, name: baseName })) {
			pasteText = '';
			return;
		}
		pasteText = text;
	}

	function onPasteCapture(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text');
		if (text && text.trim()) {
			e.preventDefault();
			pasteText = text.trim();
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
		onOpenFile(path);
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
					placeholder="Paste JSON · YAML · XML · CSV · cURL — loads instantly"
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
			{#if diagnosis}
				<PasteDiagnostic {diagnosis} {busy} onFix={onFixDiagnosis} onDismiss={onDismissDiagnosis} />
			{/if}
			<div class="row dim text-sm">
				<button class="link" onclick={onPickFile} disabled={busy}>pick a file…</button>
				<span>· or drop one anywhere · {fmtKbd('⌘⏎')} to load typed text</span>
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
		padding: var(--space-2xl) var(--space-md) var(--space-3xl);
	}
	.inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
		width: 100%;
		max-width: 560px;
	}

	.brand {
		display: flex;
		align-items: baseline;
		gap: var(--space-md);
	}
	.title {
		font-size: var(--font-size-title);
		letter-spacing: var(--label-tracking);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
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
		padding: 1px var(--space-sm);
		font-size: var(--font-size-xs);
		letter-spacing: var(--label-tracking);
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-soft);
		border: 1px solid var(--accent-line);
		pointer-events: none;
	}

	.demo-row {
		display: flex;
		justify-content: center;
		padding-top: var(--space-xs);
	}
</style>
