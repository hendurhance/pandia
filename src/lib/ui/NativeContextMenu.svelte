<script lang="ts">
	import { onMount } from 'svelte';
	import { BLOCK_CONTEXT_MENU } from '$lib/util/flags';

	type Editable = HTMLInputElement | HTMLTextAreaElement;

	let open = $state(false);
	let x = $state(0);
	let y = $state(0);
	let canCut = $state(false);
	let canCopy = $state(false);
	let canPaste = $state(false);
	let canSelectAll = $state(false);
	let editableTarget: Editable | null = $state(null);
	let selectAllTarget: HTMLElement | null = $state(null);

	function isEditable(el: EventTarget | null): el is Editable {
		return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
	}

	function getSelectionText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	function close() {
		open = false;
		editableTarget = null;
		selectAllTarget = null;
	}

	async function doCopy() {
		const text = getSelectionText();
		if (text) {
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				// clipboard access denied; silently no-op
			}
		} else if (editableTarget) {
			const { selectionStart: s, selectionEnd: e, value } = editableTarget;
			if (s != null && e != null && s !== e) {
				try {
					await navigator.clipboard.writeText(value.slice(s, e));
				} catch {
					// ignore
				}
			}
		}
		close();
	}

	async function doCut() {
		if (!editableTarget) {
			close();
			return;
		}
		const { selectionStart: s, selectionEnd: e, value } = editableTarget;
		if (s == null || e == null || s === e) {
			close();
			return;
		}
		try {
			await navigator.clipboard.writeText(value.slice(s, e));
			editableTarget.value = value.slice(0, s) + value.slice(e);
			editableTarget.setSelectionRange(s, s);
			editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
		} catch {
			// ignore
		}
		close();
	}

	async function doPaste() {
		if (!editableTarget) {
			close();
			return;
		}
		try {
			const text = await navigator.clipboard.readText();
			const { selectionStart: s, selectionEnd: e, value } = editableTarget;
			const start = s ?? value.length;
			const end = e ?? value.length;
			editableTarget.value = value.slice(0, start) + text + value.slice(end);
			editableTarget.setSelectionRange(start + text.length, start + text.length);
			editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
		} catch {
			// ignore
		}
		close();
	}

	function doSelectAll() {
		if (editableTarget) {
			editableTarget.select();
		} else if (selectAllTarget) {
			const sel = window.getSelection();
			if (sel) {
				sel.removeAllRanges();
				const range = document.createRange();
				range.selectNodeContents(selectAllTarget);
				sel.addRange(range);
			}
		}
		close();
	}

	onMount(() => {
		if (!BLOCK_CONTEXT_MENU) return;

		const onContextMenu = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			// Inputs/textareas only — anywhere else we just suppress the native
			// menu and don't show our own. (Selectable read-only text gets its
			// Copy via ⌘C; we don't want to wrap every DOM string in a menu.)
			const editable = isEditable(target) ? target : null;
			const selectionText = getSelectionText();

			// If there's literally nothing to do, just kill the native menu.
			if (!editable && !selectionText) {
				e.preventDefault();
				return;
			}

			e.preventDefault();
			x = e.clientX;
			y = e.clientY;
			editableTarget = editable;
			selectAllTarget = editable ?? target;
			canCopy =
				!!selectionText || !!(editable && editable.selectionStart !== editable.selectionEnd);
			canCut =
				!!editable &&
				editable.selectionStart !== null &&
				editable.selectionStart !== editable.selectionEnd;
			canPaste = !!editable;
			canSelectAll = !!editable || (target?.textContent?.length ?? 0) > 0;
			open = true;
		};

		const onDocClick = () => {
			if (open) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (open && e.key === 'Escape') close();
		};

		document.addEventListener('contextmenu', onContextMenu);
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('contextmenu', onContextMenu);
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

{#if open}
	<div
		class="ctx"
		style="left: {x}px; top: {y}px"
		role="menu"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.key === 'Escape' && close()}
	>
		{#if canCut}
			<button class="ctx-item" onclick={doCut}>Cut</button>
		{/if}
		{#if canCopy}
			<button class="ctx-item" onclick={doCopy}>Copy</button>
		{/if}
		{#if canPaste}
			<button class="ctx-item" onclick={doPaste}>Paste</button>
		{/if}
		{#if (canCut || canCopy || canPaste) && canSelectAll}
			<div class="ctx-sep"></div>
		{/if}
		{#if canSelectAll}
			<button class="ctx-item" onclick={doSelectAll}>Select All</button>
		{/if}
	</div>
{/if}

<style>
	.ctx {
		position: fixed;
		z-index: 9999;
		min-width: 140px;
		padding: 4px 0;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		font-size: var(--font-size-sm);
		color: var(--text);
		user-select: none;
	}
	.ctx-item {
		display: block;
		width: 100%;
		padding: 4px 12px;
		background: transparent;
		border: none;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.ctx-item:hover {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.ctx-sep {
		height: 1px;
		margin: 4px 0;
		background: var(--rule);
	}
</style>
