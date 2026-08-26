<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import type { Diagnosis, DetectKind, OpenSource } from '$lib/ipc/bindings';
	import { ipc } from '$lib/ipc/client';
	import PasteDiagnostic from './PasteDiagnostic.svelte';
	import { buildDemoSource } from '../logic/demo';
	import { stem } from '$lib/util/path';
	import { JSON_OPEN_FILTERS } from '$lib/util/file-types';
	import { fmtKbd } from '$lib/util/platform';
	import { detectFormat, formatLabel } from '../logic/detect-format';
	import URLFetchBox from './URLFetchBox.svelte';
	import RecentsBlock from './RecentsBlock.svelte';

	interface Props {
		busy: boolean;
		onOpenSource: (source: OpenSource) => Promise<boolean>;
		diagnosis: Diagnosis | null;
		onFixDiagnosis: (text: string) => void;
		onDismissDiagnosis: () => void;
	}

	let { busy, onOpenSource, diagnosis, onFixDiagnosis, onDismissDiagnosis }: Props = $props();

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
		onOpenSource({ kind: 'file', path: picked });
	}

	async function openFromText(text: string, baseName: string) {
		let source: OpenSource = { kind: 'text', text, name: baseName };
		try {
			const r = await ipc.docDetectAndConvert(text);
			if (r.error == null) {
				source = { kind: 'text', text: r.json, name: renameForDetect(baseName, r.kind) };
			}
		} catch {}

		if (await onOpenSource(source)) {
			pasteText = '';
			return;
		}
		pasteText = text;
	}

	function renameForDetect(base: string, kind: DetectKind): string {
		if (kind === 'json' || kind === 'unknown') return base;
		return `${stem(base)}.json`;
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
