<script lang="ts">
	import { save as saveDialog } from '@tauri-apps/plugin-dialog';
	import { docExport, docExportPreview, docExportToFile } from '$lib/ipc/doc';
	import type { DocHandle, ExportFormat } from '$lib/ipc/types';
	import { stem } from '$lib/util/path';
	import { CopyFlag } from '$lib/util/clipboard.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { X } from '@lucide/svelte';

	interface Props {
		handle: DocHandle;
		sourceName: string | null;
		onClose: () => void;
	}

	let { handle, sourceName, onClose }: Props = $props();

	const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string; ext: string }> = [
		{ id: 'json', label: 'JSON', ext: 'json' },
		{ id: 'json-min', label: 'JSON · min', ext: 'json' },
		{ id: 'yaml', label: 'YAML', ext: 'yaml' },
		{ id: 'csv', label: 'CSV', ext: 'csv' },
		{ id: 'xml', label: 'XML', ext: 'xml' },
	];

	const PREVIEW_CAP = 50_000; // chars rendered in the <pre>

	let format = $state<ExportFormat>('json');
	let previewText = $state('');
	let previewTruncated = $state(false);
	let busy = $state(false);
	let error: string | null = $state(null); // preview-generation failure
	let actionError: string | null = $state(null); // copy / save failure
	let copying = $state(false);
	const copyFlag = new CopyFlag();
	let seq = 0;

	const footerLabel = $derived(
		previewTruncated
			? `preview · first ${PREVIEW_CAP.toLocaleString()} chars — save writes the full output`
			: `${previewText.length.toLocaleString()} chars`,
	);

	const ext = $derived(FORMATS.find((f) => f.id === format)?.ext ?? 'txt');

	$effect(() => {
		void format;
		void regenerate();
	});

	async function regenerate() {
		const mySeq = ++seq;
		busy = true;
		error = null;
		actionError = null;
		try {
			const p = await docExportPreview(handle, format, PREVIEW_CAP);
			if (mySeq !== seq) return;
			previewText = p.text;
			previewTruncated = p.truncated;
		} catch (e) {
			if (mySeq !== seq) return;
			previewText = '';
			previewTruncated = false;
			error = String(e).replace(/^.*?Error:\s*/i, '');
		} finally {
			if (mySeq === seq) busy = false;
		}
	}

	function defaultName(): string {
		return `${stem(sourceName ?? 'export')}.${ext}`;
	}

	async function onSave() {
		if (busy) return;
		let picked: string | null;
		try {
			picked = await saveDialog({
				defaultPath: defaultName(),
				filters: [{ name: format.toUpperCase(), extensions: [ext] }],
			});
		} catch (e) {
			actionError = String(e);
			return;
		}
		if (typeof picked !== 'string') return;
		try {
			await docExportToFile(handle, format, picked);
			onClose();
		} catch (e) {
			actionError = String(e).replace(/^.*?Error:\s*/i, '');
		}
	}

	async function onCopy() {
		if (busy || copying) return;
		actionError = null;
		copying = true;
		try {
			const full = await docExport(handle, format);
			await copyFlag.copy(full);
		} catch (e) {
			actionError = String(e).replace(/^.*?Error:\s*/i, '');
		} finally {
			copying = false;
		}
	}
</script>

<Dialog {onClose}>
	<div class="dialog sheet" role="dialog" aria-label="export document">
		<div class="dialog-head">
			<span class="dialog-title">export</span>
			<div class="formats">
				{#each FORMATS as f (f.id)}
					<button class="fmt" class:active={format === f.id} onclick={() => (format = f.id)}
						>{f.label}</button
					>
				{/each}
			</div>
			<span class="grow"></span>
			<button class="btn-close" onclick={onClose} aria-label="close" title="close (esc)"
				><Icon icon={X} size="sm" /></button
			>
		</div>

		<div class="preview-wrap">
			{#if busy}
				<div class="state dim text-sm">generating…</div>
			{:else if error}
				<div class="state err text-sm">{error}</div>
			{:else}
				<pre class="preview"><code>{previewText}</code></pre>
			{/if}
		</div>

		<div class="dialog-foot">
			<span class="text-sm" class:dim={!actionError} class:err={actionError}>
				{actionError ?? (busy ? '' : footerLabel)}
			</span>
			<span class="grow"></span>
			<button class="btn" onclick={onCopy} disabled={busy || copying}
				>{copyFlag.done ? 'copied' : copying ? 'copying…' : 'copy'}</button
			>
			<button class="btn btn-primary" onclick={onSave} disabled={busy}>save…</button>
		</div>
	</div>
</Dialog>

<style>
	.sheet {
		width: min(640px, 90%);
		height: min(620px, 82vh);
	}

	.formats {
		display: flex;
		gap: 0.2rem;
	}
	.fmt {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.5rem;
		background: var(--bg);
		border: var(--rule-width) solid var(--rule);
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.fmt:hover {
		color: var(--text);
	}
	.fmt.active {
		color: var(--bg);
		background: var(--accent);
		border-color: var(--accent);
	}

	.preview-wrap {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
	}
	.preview {
		flex: 1;
		margin: 0;
		padding: 0.6rem 0.8rem;
		overflow: auto;
		background: var(--bg);
		font-size: var(--font-size-sm);
		line-height: 1.5;
		white-space: pre;
	}
	.state {
		padding: 1rem;
	}
	.err {
		color: var(--accent);
	}
</style>
