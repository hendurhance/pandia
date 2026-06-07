<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import {
		docOpen,
		docClose,
		docGetSlice,
		docGetValue,
		docApplyOp,
		docColumnSchema,
		docUndo,
		docRedo,
	} from '$lib/ipc/doc';
	import type { OpenResult, NodeView, Op, Path } from '$lib/ipc/types';
	import { fmtBytes } from '$lib/util/format';
	import { SANDBOX_ENABLED } from '$lib/util/flags';

	if (!SANDBOX_ENABLED && typeof window !== 'undefined') {
		window.location.replace('/');
	}

	type LogLevel = 'info' | 'ok' | 'err';
	interface LogEntry {
		ts: string;
		level: LogLevel;
		label: string;
		body: string;
	}

	let docs: OpenResult[] = $state([]);
	let activeHandle: string | null = $state(null);
	let log: LogEntry[] = $state([]);

	let pathText = $state('[]');
	let textBody = $state('{"events": [10, 20, 30], "meta": {"name": "demo"}}');
	let textName = $state('inline.json');
	let filePathText = $state('');
	let rangeStart = $state(0);
	let rangeEnd = $state(50);
	let opText = $state('{"kind": "setValue", "path": ["meta", "name"], "value": "edited"}');

	function stamp(): string {
		const d = new Date();
		return (
			d.toLocaleTimeString(undefined, { hour12: false }) +
			'.' +
			String(d.getMilliseconds()).padStart(3, '0')
		);
	}

	const LOG_BODY_CAP = 4096;
	const LOG_ENTRY_CAP = 30;

	function logEntry(level: LogLevel, label: string, body: unknown) {
		let text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
		let suffix = '';
		if (Array.isArray(body) && body.length > 20) {
			suffix = `\n\n… ${body.length} total entries (showing first ${Math.min(20, body.length)})`;
			text = JSON.stringify(body.slice(0, 20), null, 2);
		}
		if (text.length > LOG_BODY_CAP) {
			text = text.slice(0, LOG_BODY_CAP) + `\n\n… (+${text.length - LOG_BODY_CAP} chars truncated)`;
		}
		log = [{ ts: stamp(), level, label, body: text + suffix }, ...log].slice(0, LOG_ENTRY_CAP);
	}

	function parsePathLiteral(): Path | Error {
		const trimmed = pathText.trim();
		if (trimmed === '' || trimmed === '$') return [];
		try {
			const parsed = JSON.parse(trimmed);
			if (!Array.isArray(parsed)) return new Error('path must be a JSON array');
			for (const seg of parsed) {
				if (typeof seg !== 'string' && typeof seg !== 'number') {
					return new Error(`segment ${JSON.stringify(seg)} is not string|number`);
				}
			}
			return parsed as Path;
		} catch (e) {
			return new Error(`invalid JSON: ${(e as Error).message}`);
		}
	}

	async function onOpenText() {
		const label = `doc_open(text "${textName}")`;
		try {
			const res = await docOpen({ kind: 'text', text: textBody, name: textName || null });
			docs = [...docs, res];
			activeHandle = res.handle;
			logEntry('ok', label, res);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onOpenPath() {
		if (!filePathText.trim()) return;
		const label = `doc_open(file ${filePathText})`;
		try {
			const res = await docOpen({ kind: 'file', path: filePathText.trim() });
			docs = [...docs, res];
			activeHandle = res.handle;
			logEntry('ok', label, res);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onPickFile() {
		try {
			const picked = await openDialog({
				multiple: false,
				directory: false,
				filters: [{ name: 'JSON', extensions: ['json'] }],
			});
			if (typeof picked === 'string') {
				filePathText = picked;
				await onOpenPath();
			}
		} catch (e) {
			logEntry('err', 'plugin-dialog open', String(e));
		}
	}

	async function onClose(handle: string) {
		try {
			const ok = await docClose(handle);
			docs = docs.filter((d) => d.handle !== handle);
			if (activeHandle === handle) activeHandle = docs[0]?.handle ?? null;
			logEntry(ok ? 'ok' : 'info', `doc_close(${shortId(handle)})`, ok);
		} catch (e) {
			logEntry('err', `doc_close(${shortId(handle)})`, String(e));
		}
	}

	async function onGetSlice() {
		if (!activeHandle) return;
		const path = parsePathLiteral();
		if (path instanceof Error) {
			logEntry('err', 'parse path', path.message);
			return;
		}
		const label = `doc_get_slice(${shortId(activeHandle)}, ${pathText}, ${rangeStart}..${rangeEnd})`;
		try {
			const t0 = performance.now();
			const slice: NodeView[] = await docGetSlice(activeHandle, path, rangeStart, rangeEnd);
			const dt = (performance.now() - t0).toFixed(1);
			logEntry('ok', `${label} · ${dt} ms · ${slice.length} nodes`, slice);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onGetValue() {
		if (!activeHandle) return;
		const path = parsePathLiteral();
		if (path instanceof Error) {
			logEntry('err', 'parse path', path.message);
			return;
		}
		const label = `doc_get_value(${shortId(activeHandle)}, ${pathText})`;
		try {
			const t0 = performance.now();
			const value = await docGetValue(activeHandle, path);
			const dt = (performance.now() - t0).toFixed(1);
			logEntry('ok', `${label} · ${dt} ms`, value);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	function parseOp(): Op | Error {
		try {
			const parsed = JSON.parse(opText) as unknown;
			if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
				return new Error('op must be an object with a "kind" field');
			}
			return parsed as Op;
		} catch (e) {
			return new Error(`invalid JSON: ${(e as Error).message}`);
		}
	}

	async function onApplyOp() {
		if (!activeHandle) return;
		const op = parseOp();
		if (op instanceof Error) {
			logEntry('err', 'parse op', op.message);
			return;
		}
		const label = `doc_apply_op(${shortId(activeHandle)}, ${op.kind})`;
		try {
			const t0 = performance.now();
			const result = await docApplyOp(activeHandle, op);
			const dt = (performance.now() - t0).toFixed(1);
			logEntry('ok', `${label} · ${dt} ms · v${result.version}`, result);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onColumnSchema() {
		if (!activeHandle) return;
		const path = parsePathLiteral();
		if (path instanceof Error) {
			logEntry('err', 'parse path', path.message);
			return;
		}
		const label = `doc_column_schema(${shortId(activeHandle)}, ${pathText})`;
		try {
			const t0 = performance.now();
			const schema = await docColumnSchema(activeHandle, path);
			const dt = (performance.now() - t0).toFixed(1);
			const tag = schema.gridSuitable
				? `grid · ${schema.columns.length} cols`
				: `not-grid · ${schema.reason ?? '?'}`;
			logEntry('ok', `${label} · ${dt} ms · ${tag} · ${schema.sampled}/${schema.rowCount}`, schema);
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onUndo() {
		if (!activeHandle) return;
		const label = `doc_undo(${shortId(activeHandle)})`;
		try {
			const t0 = performance.now();
			const result = await docUndo(activeHandle);
			const dt = (performance.now() - t0).toFixed(1);
			if (result === null) {
				logEntry('info', `${label} · ${dt} ms`, 'no undo entries');
			} else {
				logEntry('ok', `${label} · ${dt} ms · v${result.version}`, result);
			}
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	async function onRedo() {
		if (!activeHandle) return;
		const label = `doc_redo(${shortId(activeHandle)})`;
		try {
			const t0 = performance.now();
			const result = await docRedo(activeHandle);
			const dt = (performance.now() - t0).toFixed(1);
			if (result === null) {
				logEntry('info', `${label} · ${dt} ms`, 'no redo entries');
			} else {
				logEntry('ok', `${label} · ${dt} ms · v${result.version}`, result);
			}
		} catch (e) {
			logEntry('err', label, String(e));
		}
	}

	function shortId(h: string): string {
		return h.slice(0, 8);
	}
</script>

<section class="page">
	<header class="rule top">
		<a href="/" class="back">← /</a>
		<span class="label">sandbox</span>
		<span class="dim">raw IPC surface for v1 commands</span>
	</header>

	<div class="cols">
		<aside class="left rule-r">
			<div class="block">
				<div class="label">open from text</div>
				<input bind:value={textName} placeholder="name" />
				<textarea bind:value={textBody} rows="6" spellcheck="false"></textarea>
				<button onclick={onOpenText}>doc_open(text)</button>
			</div>

			<div class="block">
				<div class="label">open from file path</div>
				<input bind:value={filePathText} placeholder="/abs/path/to/file.json" />
				<div class="row">
					<button onclick={onOpenPath} disabled={!filePathText.trim()}>doc_open(file)</button>
					<button onclick={onPickFile}>pick…</button>
				</div>
			</div>

			<div class="block">
				<div class="label">open docs</div>
				{#if docs.length === 0}
					<div class="dim small">none</div>
				{/if}
				{#each docs as d (d.handle)}
					<div
						class="doc-row"
						class:active={d.handle === activeHandle}
						role="button"
						tabindex="0"
						onclick={() => (activeHandle = d.handle)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') activeHandle = d.handle;
						}}
					>
						<span class="hid">{shortId(d.handle)}</span>
						<span class="dim small">
							{d.summary.rootKind}
							{d.summary.lazy ? '· lazy' : ''}
							· {fmtBytes(d.summary.sourceSize)}
							{d.summary.rootChildCount !== null ? `· ${d.summary.rootChildCount}` : ''}
						</span>
						<button
							class="x"
							onclick={(e) => {
								e.stopPropagation();
								onClose(d.handle);
							}}>✕</button
						>
					</div>
				{/each}
			</div>

			<div class="block">
				<div class="label">slice / value (active doc)</div>
				<input bind:value={pathText} placeholder="[] or [&quot;events&quot;, 42]" />
				<div class="row">
					<input type="number" bind:value={rangeStart} min="0" />
					<input type="number" bind:value={rangeEnd} min="0" />
				</div>
				<div class="row">
					<button onclick={onGetSlice} disabled={!activeHandle}>doc_get_slice</button>
					<button onclick={onGetValue} disabled={!activeHandle}>doc_get_value</button>
				</div>
				<div class="row">
					<button onclick={onColumnSchema} disabled={!activeHandle}>doc_column_schema</button>
				</div>
			</div>

			<div class="block">
				<div class="label">apply / undo / redo (active doc)</div>
				<textarea
					bind:value={opText}
					rows="4"
					spellcheck="false"
					placeholder={'op JSON, e.g. {"kind":"setValue","path":["a"],"value":1}'}
				></textarea>
				<div class="row">
					<button onclick={onApplyOp} disabled={!activeHandle}>doc_apply_op</button>
					<button onclick={onUndo} disabled={!activeHandle}>doc_undo</button>
					<button onclick={onRedo} disabled={!activeHandle}>doc_redo</button>
				</div>
			</div>
		</aside>

		<div class="log">
			<div class="label log-head">log</div>
			{#if log.length === 0}
				<div class="dim small">no calls yet</div>
			{/if}
			{#each log as entry, i (i + entry.ts)}
				<div class="entry rule-b" class:ok={entry.level === 'ok'} class:err={entry.level === 'err'}>
					<div class="entry-head">
						<span class="dim small">{entry.ts}</span>
						<span class={'tag ' + entry.level}>{entry.level}</span>
						<span class="entry-label">{entry.label}</span>
					</div>
					<pre>{entry.body}</pre>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	header.top {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		padding: 0.6rem 1rem;
	}
	.back {
		color: var(--text-dim);
		text-decoration: none;
	}
	.back:hover {
		color: var(--accent);
	}
	.dim {
		color: var(--text-dim);
	}
	.small {
		font-size: 11px;
	}

	.cols {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.left {
		width: 360px;
		padding: 0.75rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.rule-r {
		border-right: 1px solid var(--rule);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row {
		display: flex;
		gap: 0.4rem;
	}
	.row > * {
		flex: 1;
	}

	textarea {
		font: inherit;
		color: var(--text);
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		padding: 0.4rem;
		resize: vertical;
		min-height: 80px;
		width: 100%;
	}

	.doc-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.5rem;
		text-align: left;
		align-items: center;
		padding: 0.35rem 0.5rem;
		background: var(--bg-elev);
		border: 1px solid var(--rule);
		cursor: pointer;
	}
	.doc-row:hover {
		color: var(--accent);
	}
	.doc-row.active {
		color: var(--accent);
		border-color: var(--accent);
	}
	.hid {
		color: var(--accent-2);
	}
	.x {
		padding: 0 0.4rem;
		background: transparent;
		border: none;
	}

	.log {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		min-width: 0;
	}
	.log-head {
		padding: 0.25rem 0;
	}
	.entry {
		padding: 0.5rem 0;
	}
	.rule-b {
		border-bottom: 1px solid var(--rule);
	}
	.entry-head {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.tag {
		font-size: 10.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	.tag.ok {
		color: var(--success);
	}
	.tag.err {
		color: var(--accent);
	}
	.tag.info {
		color: var(--text-dim);
	}
	.entry-label {
		color: var(--text);
	}
	pre {
		font: inherit;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--text-dim);
		margin-top: 0.3rem;
		max-height: 360px;
		overflow: auto;
	}
</style>
