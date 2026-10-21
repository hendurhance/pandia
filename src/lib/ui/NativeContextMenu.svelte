<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorView } from '@codemirror/view';
	import { selectAll } from '@codemirror/commands';
	import { BLOCK_CONTEXT_MENU } from '$lib/util/flags';
	import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

	type Editable = HTMLInputElement | HTMLTextAreaElement;

	let open = $state(false);
	let x = $state(0);
	let y = $state(0);
	let canCut = $state(false);
	let canCopy = $state(false);
	let canPaste = $state(false);
	let canSelectAll = $state(false);
	let editableTarget: Editable | null = $state(null);
	let editorTarget: EditorView | null = $state(null);
	let selectAllTarget: HTMLElement | null = $state(null);

	function isEditable(el: EventTarget | null): el is Editable {
		return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
	}

	function getSelectionText(): string {
		return window.getSelection()?.toString() ?? '';
	}

	function getEditorSelectionText(view: EditorView): string {
		const { from, to } = view.state.selection.main;
		return view.state.sliceDoc(from, to);
	}

	function close() {
		open = false;
		editableTarget = null;
		editorTarget = null;
		selectAllTarget = null;
	}

	function onMenuMousedown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	async function doCopy() {
		const text = editorTarget ? getEditorSelectionText(editorTarget) : getSelectionText();
		if (text) {
			try {
				await writeText(text);
			} catch {
				// clipboard access denied; silently no-op
			}
		} else if (editableTarget) {
			const { selectionStart: s, selectionEnd: e, value } = editableTarget;
			if (s != null && e != null && s !== e) {
				try {
					await writeText(value.slice(s, e));
				} catch {
					// ignore
				}
			}
		}
		close();
	}

	async function doCut() {
		const editor = editorTarget;
		if (editor) {
			const { from, to } = editor.state.selection.main;
			try {
				await writeText(editor.state.sliceDoc(from, to));
				editor.dispatch({ changes: { from, to }, userEvent: 'delete.cut' });
			} catch {
				// ignore
			}
			close();
			return;
		}
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
			await writeText(value.slice(s, e));
			editableTarget.value = value.slice(0, s) + value.slice(e);
			editableTarget.setSelectionRange(s, s);
			editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
		} catch {
			// ignore
		}
		close();
	}

	async function doPaste() {
		const editor = editorTarget;
		if (editor) {
			try {
				const text = await readText();
				editor.dispatch(editor.state.replaceSelection(text), {
					userEvent: 'input.paste',
					scrollIntoView: true,
				});
			} catch {
				// ignore
			}
			close();
			return;
		}
		if (!editableTarget) {
			close();
			return;
		}
		try {
			const text = await readText();
			const { selectionStart: s, selectionEnd: e, value } = editableTarget;
			const start = s ?? value.length;
			const end = e ?? value.length;
			editableTarget.value = value.slice(0, start) + text + value.slice(end);
			editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
			editableTarget.setSelectionRange(start + text.length, start + text.length);
		} catch {
			// ignore
		}
		close();
	}

	function doSelectAll() {
		if (editorTarget) {
			selectAll(editorTarget);
		} else if (editableTarget) {
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
			const editable = isEditable(target) ? target : null;
			const cm = target?.isContentEditable ? target.closest<HTMLElement>('.cm-editor') : null;
			const editor = cm && EditorView.findFromDOM(cm);
			const selectionText = editor ? getEditorSelectionText(editor) : getSelectionText();

			if (!editable && !editor && !selectionText) {
				e.preventDefault();
				return;
			}

			e.preventDefault();
			x = e.clientX;
			y = e.clientY;
			editableTarget = editable;
			editorTarget = editor;
			selectAllTarget = editable ?? target;
			canCopy =
				!!selectionText || !!(editable && editable.selectionStart !== editable.selectionEnd);
			canCut =
				(!!editor && !!selectionText) ||
				(!!editable &&
					editable.selectionStart !== null &&
					editable.selectionStart !== editable.selectionEnd);
			canPaste = !!editable || !!editor;
			canSelectAll = !!editable || !!editor || (target?.textContent?.length ?? 0) > 0;
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
		onmousedown={onMenuMousedown}
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
		padding: var(--space-xs) 0;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		box-shadow: var(--shadow-pop);
		font-size: var(--font-size-sm);
		color: var(--text);
		user-select: none;
	}
	.ctx-item {
		display: block;
		width: 100%;
		padding: var(--space-xs) var(--space-md);
		background: transparent;
		border: none;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.ctx-item:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	.ctx-sep {
		height: 1px;
		margin: var(--space-xs) 0;
		background: var(--rule);
	}
</style>
