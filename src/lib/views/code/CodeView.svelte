<script module lang="ts">
	export interface CodeViewApi {
		flush: () => Promise<boolean>;

		revert: () => void;

		undo: () => boolean;
		redo: () => boolean;

		cmSearch: (query: string, caseSensitive: boolean) => number;
		cmFindNext: () => void;
		cmFindPrev: () => void;

		cmReplaceAll: (query: string, replacement: string, caseSensitive: boolean) => number;
	}
</script>

<script lang="ts">
	import { EditorState } from '@codemirror/state';
	import { fmtBytes } from '$lib/util/format';
	import {
		EditorView,
		lineNumbers,
		highlightActiveLine,
		highlightActiveLineGutter,
		drawSelection,
		highlightSpecialChars,
		keymap,
	} from '@codemirror/view';
	import { json, jsonParseLinter } from '@codemirror/lang-json';
	import { linter, lintGutter } from '@codemirror/lint';
	import {
		syntaxHighlighting,
		bracketMatching,
		codeFolding,
		foldGutter,
		foldCode,
		unfoldCode,
		foldAll,
		unfoldAll,
	} from '@codemirror/language';
	import {
		defaultKeymap,
		history,
		historyKeymap,
		indentWithTab,
		undo,
		redo,
	} from '@codemirror/commands';
	import {
		search,
		SearchQuery,
		setSearchQuery,
		findNext as cmFindNextCmd,
		findPrevious as cmFindPrevCmd,
		replaceAll as cmReplaceAllCmd,
		SearchCursor,
	} from '@codemirror/search';
	import { docGetValue } from '$lib/ipc/doc';
	import { noirHighlight, noirTheme } from './logic/codemirror-theme';
	import type { DocHandle, Path } from '$lib/ipc/types';
	import {
		diffHighlightExtension,
		lookupOffsets,
		setHighlights,
		stringifyWithOffsets,
		type Highlight,
	} from './logic/highlights';

	interface Props {
		handle: DocHandle | null;
		sourceSize: number;
		highlights?: Highlight[];
		activePath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;

		editable?: boolean;

		onCommit?: (text: string) => boolean | Promise<boolean>;

		onDirtyChange?: (dirty: boolean) => void;

		onReady?: (api: CodeViewApi | null) => void;

		onParseState?: (state: { valid: boolean; message: string | null } | null) => void;
	}

	let {
		handle,
		sourceSize,
		highlights = [],
		activePath = null,
		onScrollerReady,
		editable = false,
		onCommit,
		onDirtyChange,
		onReady,
		onParseState,
	}: Props = $props();

	const SIZE_CAP = 50 * 1024 * 1024;
	const tooBig = $derived(sourceSize > SIZE_CAP);

	let container: HTMLDivElement | undefined = $state();
	let loading = $state(false);
	let error: string | null = $state(null);

	let editorView: EditorView | undefined;
	let editorOffsets: Map<string, [number, number]> | null = null;

	let dirty = $state(false);
	let parseError: string | null = $state(null);
	let baseline = '';
	let programmatic = false;

	function setDirty(d: boolean) {
		if (dirty === d) return;
		dirty = d;
		onDirtyChange?.(d);
	}

	let parseStateTimer: ReturnType<typeof setTimeout> | undefined;
	function emitParseState() {
		if (!editable || !onParseState || !editorView) return;
		const text = editorView.state.doc.toString();
		try {
			JSON.parse(text);
			onParseState({ valid: true, message: null });
		} catch (e) {
			onParseState({ valid: false, message: (e as Error).message });
		}
	}
	function scheduleParseState() {
		if (!editable || !onParseState) return;
		clearTimeout(parseStateTimer);
		parseStateTimer = setTimeout(emitParseState, 200);
	}

	function setBufferText(text: string) {
		if (!editorView) return;
		programmatic = true;
		editorView.dispatch({
			changes: { from: 0, to: editorView.state.doc.length, insert: text },
		});
		programmatic = false;
	}

	async function commit(): Promise<boolean> {
		if (!editable || !editorView) return true;
		const text = editorView.state.doc.toString();
		if (text === baseline) {
			setDirty(false);
			parseError = null;
			return true;
		}
		try {
			JSON.parse(text); // validate only — Rust does the precision-preserving parse
		} catch (e) {
			parseError = (e as Error).message;
			return false;
		}
		const ok = (await onCommit?.(text)) ?? true;
		if (!ok) {
			parseError = 'could not apply edit';
			return false;
		}
		baseline = text;
		parseError = null;
		setDirty(false);
		return true;
	}

	function revert() {
		if (!editorView) return;
		setBufferText(baseline);
		parseError = null;
		setDirty(false);
	}

	function countMatches(view: EditorView, query: string, caseSensitive: boolean): number {
		const doc = view.state.doc;
		const cursor = new SearchCursor(
			doc,
			query,
			0,
			doc.length,
			caseSensitive ? undefined : (s: string) => s.toLowerCase(),
		);
		let n = 0;
		while (!cursor.next().done) n++;
		return n;
	}

	const api: CodeViewApi = {
		flush: () => commit(),
		revert,
		undo: () => (editorView ? undo(editorView) : false),
		redo: () => (editorView ? redo(editorView) : false),
		cmSearch: (query, caseSensitive) => {
			if (!editorView) return 0;
			editorView.dispatch({
				effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive })),
			});
			if (!query) return 0;
			const count = countMatches(editorView, query, caseSensitive);
			if (count > 0) cmFindNextCmd(editorView); // land on the first match
			return count;
		},
		cmFindNext: () => {
			if (editorView) cmFindNextCmd(editorView);
		},
		cmFindPrev: () => {
			if (editorView) cmFindPrevCmd(editorView);
		},
		cmReplaceAll: (query, replacement, caseSensitive) => {
			if (!editorView || !query) return 0;
			editorView.dispatch({
				effects: setSearchQuery.of(
					new SearchQuery({ search: query, replace: replacement, caseSensitive }),
				),
			});
			const count = countMatches(editorView, query, caseSensitive);
			cmReplaceAllCmd(editorView);
			return count;
		},
	};

	$effect(() => {
		if (!container || tooBig || !handle) return;

		let cancelled = false;
		let view: EditorView | undefined;

		loading = true;
		error = null;

		docGetValue(handle, [])
			.then((value) => {
				if (cancelled || !container) return;
				const { text, offsets } = stringifyWithOffsets(value);
				editorOffsets = offsets;
				baseline = text;
				setDirty(false);
				parseError = null;
				view = new EditorView({
					parent: container,
					state: EditorState.create({
						doc: text,
						extensions: [
							lineNumbers(),
							highlightActiveLineGutter(),
							highlightSpecialChars(),
							drawSelection(),
							highlightActiveLine(),
							bracketMatching(),
							codeFolding(),
							foldGutter(),
							syntaxHighlighting(noirHighlight),
							json(),
							diffHighlightExtension(),
							search(),
							keymap.of([
								{ key: 'Mod-[', run: foldCode },
								{ key: 'Mod-]', run: unfoldCode },
								{ key: 'Mod-Shift-[', run: foldAll },
								{ key: 'Mod-Shift-]', run: unfoldAll },
							]),
							...(editable ? editExtensions() : readOnlyExtensions()),
							noirTheme,
						],
					}),
				});
				editorView = view;
				applyDecorations();
				onScrollerReady?.(view.scrollDOM);
				if (editable) {
					onReady?.(api);
					emitParseState(); // initial buffer is the committed doc → valid
				}
			})
			.catch((e) => {
				if (!cancelled) error = String(e);
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});

		return () => {
			cancelled = true;
			clearTimeout(parseStateTimer);
			if (editable && view) {
				onParseState?.(null);
				const text = view.state.doc.toString();
				if (text !== baseline) {
					try {
						JSON.parse(text); // validate; an invalid buffer is discarded on unmount
						void onCommit?.(text); // Rust re-parses with arbitrary_precision
					} catch {}
				}
				onReady?.(null);
			}
			view?.destroy();
			editorView = undefined;
			editorOffsets = null;
		};
	});

	function readOnlyExtensions() {
		return [EditorState.readOnly.of(true), EditorView.editable.of(false)];
	}

	function editExtensions() {
		return [
			history(),
			keymap.of([
				{ key: 'Mod-Enter', run: () => (void commit(), true) },
				{ key: 'Escape', run: () => (revert(), true) },
				...historyKeymap,
				...defaultKeymap,
				indentWithTab,
			]),
			lintGutter(),
			linter(jsonParseLinter()),
			EditorView.updateListener.of((u) => {
				if (programmatic || !u.docChanged) return;
				setDirty(true);
				if (parseError) parseError = null;
				scheduleParseState();
			}),
		];
	}

	function applyDecorations() {
		if (!editorView || !editorOffsets) return;
		const ranges: Array<{ from: number; to: number; kind: Highlight['kind'] }> = [];
		for (const h of highlights) {
			const range = lookupOffsets(editorOffsets, h.path);
			if (range) ranges.push({ from: range[0], to: range[1], kind: h.kind });
		}
		const active = activePath ? lookupOffsets(editorOffsets, activePath) : null;
		editorView.dispatch({
			effects: setHighlights.of({
				ranges,
				active: active ? { from: active[0], to: active[1] } : null,
			}),
		});
		if (active) {
			editorView.dispatch({
				effects: EditorView.scrollIntoView(active[0], {
					y: 'center',
				}),
			});
		}
	}

	$effect(() => {
		void highlights;
		void activePath;
		applyDecorations();
	});
</script>

{#if tooBig}
	<div class="empty-state">
		<div class="empty-state-inner">
			<div class="label">code view unavailable</div>
			<p>this document is {fmtBytes(sourceSize)} — code view is capped at {fmtBytes(SIZE_CAP)}.</p>
			<p class="dim text-sm">use tree view: it streams slices from Rust regardless of size.</p>
		</div>
	</div>
{:else}
	<div class="host">
		<div class="cm-wrap" bind:this={container}></div>
		{#if editable && parseError}
			<div class="edit-bar">
				<span class="eb-msg">
					<span class="eb-dot" aria-hidden="true"></span>parse error · {parseError}
				</span>
			</div>
		{/if}
		{#if loading}<div class="status loading">Loading…</div>{/if}
		{#if error}<div class="status err">{error}</div>{/if}
	</div>
{/if}

<style>
	.host {
		flex: 1;
		min-height: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.cm-wrap {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.cm-wrap :global(.cm-editor) {
		height: 100%;
	}

	.status {
		position: absolute;
		top: 0.4rem;
		right: 1rem;
		font-size: 11px;
		padding: 0.15rem 0.5rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		pointer-events: none;
	}
	.status.loading {
		color: var(--text-dim);
	}
	.status.err {
		color: var(--accent);
		border-color: var(--accent);
	}

	.edit-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.3rem 1rem;
		background: var(--bg-elev);
		border-top: var(--rule-width) solid var(--accent);
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.eb-msg {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.eb-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}

	.cm-wrap :global(.cm-diff-added) {
		background: rgba(123, 166, 136, 0.18);
	}
	.cm-wrap :global(.cm-diff-removed) {
		background: var(--accent-fill);
		text-decoration: line-through;
		text-decoration-color: var(--accent-line);
	}
	.cm-wrap :global(.cm-diff-changed) {
		background: rgba(201, 162, 75, 0.18);
	}
	.cm-wrap :global(.cm-diff-active) {
		outline: 1px solid var(--accent);
		outline-offset: 0;
	}
</style>
