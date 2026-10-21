<script lang="ts">
	import { untrack } from 'svelte';
	import { open as openInBrowser } from '@tauri-apps/plugin-shell';
	import {
		isContent,
		isExpandable,
		isPlaceholder,
		isVGap,
		pathKey,
		rowKey,
		vgapCount,
		type ContentRow,
		type MenuAction,
		type Row,
		type VirtualGapRow,
	} from '../logic/model';
	import { chipText, openBracket, renderKey, detectUrl } from '../logic/row-format';
	import { mayBeImage } from '$lib/views/shared/image-source';
	import { imagePreview } from '$lib/views/shared/image-preview.svelte';
	import { editActionFor } from '../logic/row-menu-model';
	import { gapAt, ROW_DRAG_EDGE_ZONE, ROW_DRAG_MAX_STEP } from '../logic/row-drag-math';
	import { createAutoScroller } from '$lib/ui/auto-scroll';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from '@lucide/svelte';
	import { DEFAULT_ROW_H, OVERSCAN, scaledOffset } from '$lib/views/shared/scroll-math';
	import { WindowedScroller } from '$lib/views/shared/windowed-scroller.svelte';
	import type { DiffKind, Path } from '$lib/ipc/bindings';
	import InlineCellEditor from './InlineCellEditor.svelte';
	import { fmtKbd } from '$lib/util/platform';

	interface ScrollRequest {
		idx: number;
		nonce: number;
	}

	interface EditingState {
		path: Path;
		field: 'key' | 'value';
		buffer: string;
	}

	interface Props {
		rows: Row[];
		selectedIndex: number;
		onToggle: (index: number) => void;
		onSelect: (index: number) => void;
		onVisibleRange: (start: number, end: number) => void;
		onRowMenu: (index: number, x: number, y: number) => void;
		onRowAction?: (index: number, action: MenuAction) => void;
		scrollRequest: ScrollRequest | null;
		editing: EditingState | null;
		onEditInput: (text: string) => void;
		onEditCommit: () => void;
		onEditCancel: () => void;

		onReorder?: (dragged: ContentRow, gap: number) => void;

		readOnly?: boolean;

		diffHighlights?: Map<string, DiffKind>;

		invalidMarks?: Map<string, 'error' | 'ancestor' | 'stale-error' | 'stale-ancestor'>;

		cutPath?: Path | null;

		onScrollerReady?: (el: HTMLElement) => void;

		onMaterializeGap?: (gap: VirtualGapRow, fromIdx: number, toIdx: number) => void;

		readString?: (path: Path) => Promise<string | null>;
	}

	let {
		rows,
		selectedIndex,
		onToggle,
		onSelect,
		onVisibleRange,
		onRowMenu,
		onRowAction,
		scrollRequest,
		editing,
		onEditInput,
		onEditCommit,
		onEditCancel,
		onReorder,
		readOnly = false,
		diffHighlights,
		invalidMarks,
		cutPath = null,
		onScrollerReady,
		onMaterializeGap,
		readString,
	}: Props = $props();

	const cutKey = $derived(cutPath ? pathKey(cutPath) : null);
	const editingKey = $derived(editing ? pathKey(editing.path) : null);

	const tallHeights = new Map<string, number>();
	let heightsVersion = $state(0);

	function heightAt(i: number): number {
		const r = rows[i];
		if (!r) return DEFAULT_ROW_H;
		if (r.variant === 'vgap') return vgapCount(r) * DEFAULT_ROW_H;
		return tallHeights.get(rowKey(r)) ?? DEFAULT_ROW_H;
	}

	const s = new WindowedScroller({
		rowCount: () => rows.length,
		rowHeight: DEFAULT_ROW_H,
		overscan: OVERSCAN,
		heightAt,
		heightsVersion: () => heightsVersion,
		keyAt: (i) => {
			const r = rows[i];
			return r ? rowKey(r) : '';
		},
		onWidthChange: () => {
			if (tallHeights.size > 0) {
				tallHeights.clear();
				heightsVersion += 1;
			}
		},
	});
	const offsets = $derived(s.offsets);
	const contentHeight = $derived(s.contentHeight);
	const startIndex = $derived(s.window.start);
	const endIndex = $derived(s.window.end);
	const visibleRows = $derived(rows.slice(startIndex, endIndex));

	$effect(() => {
		onVisibleRange(startIndex, endIndex);
	});

	const ROW_SLACK_CH = 12;
	let maxRowCh = $state(0);
	let maxRowLen = 0;
	$effect(() => {
		const vis = visibleRows;
		const len = rows.length;
		untrack(() => {
			let m = len < maxRowLen ? 0 : maxRowCh;
			maxRowLen = len;
			for (const r of vis) {
				if (r.variant === 'vgap') continue;
				const text =
					r.variant === 'content'
						? renderKey(r).length + Math.max(r.preview.length, chipText(r)?.length ?? 0)
						: 16;
				const est = Math.ceil((r.depth * 8) / 3 + text * 1.01) + ROW_SLACK_CH;
				if (est > m) m = est;
			}
			if (m !== maxRowCh) maxRowCh = m;
		});
	});

	$effect(() => {
		if (!onMaterializeGap) return;
		const top = s.offset;
		const bottom = s.offset + s.viewportHeight;
		const GAP_OVERSCAN_ROWS = 32;
		for (let i = startIndex; i < endIndex && i < rows.length; i++) {
			const r = rows[i];
			if (!r || r.variant !== 'vgap') continue;
			const gapTop = offsets[i];
			const gapBottom = offsets[i + 1];
			if (gapTop === undefined || gapBottom === undefined) continue;
			if (gapBottom <= top || gapTop >= bottom) continue; // not intersecting
			const overlapTop = Math.max(0, top - gapTop);
			const overlapBottom = Math.min(gapBottom - gapTop, bottom - gapTop);
			const fromIdx = r.fromIndex + Math.floor(overlapTop / DEFAULT_ROW_H) - GAP_OVERSCAN_ROWS;
			const toIdx = r.fromIndex + Math.ceil(overlapBottom / DEFAULT_ROW_H) + GAP_OVERSCAN_ROWS;
			onMaterializeGap(r, Math.max(r.fromIndex, fromIdx), Math.min(r.toIndex, toIdx));
		}
	});

	$effect(() => {
		if (s.el) onScrollerReady?.(s.el);
	});

	$effect(() => {
		void rows;
		void s.scrollTop;
		void s.viewportHeight;
		void editing;
		const scroller = s.el;
		if (!scroller) return;
		untrack(() => {
			if (!editing) {
				if (tallHeights.size > 0) {
					tallHeights.clear();
					heightsVersion += 1;
				}
				return;
			}
			let changed = false;
			for (const el of scroller.querySelectorAll<HTMLElement>('.r[data-ri]')) {
				const ri = Number(el.dataset.ri);
				if (!Number.isInteger(ri) || ri < 0 || ri >= rows.length) continue;
				const h = el.offsetHeight;
				if (h <= 0) continue;
				const row = rows[ri];
				if (!row) continue;
				const key = rowKey(row);
				if (h > DEFAULT_ROW_H + 1) {
					if (tallHeights.get(key) !== h) {
						tallHeights.set(key, h);
						changed = true;
					}
				} else if (tallHeights.delete(key)) {
					changed = true;
				}
			}
			if (changed) heightsVersion += 1;
		});
	});

	$effect(() => {
		if (rows.length === 0 && tallHeights.size > 0) {
			tallHeights.clear();
			heightsVersion += 1;
		}
	});

	$effect(() => {
		const req = scrollRequest;
		if (!req) return;
		untrack(() => s.scrollToIndex(req.idx));
	});

	function onUrlClick(e: MouseEvent, url: string) {
		e.preventDefault();
		e.stopPropagation();
		openInBrowser(url).catch(() => {});
	}

	function onImageHover(e: PointerEvent, row: ContentRow) {
		const url = detectUrl(row.preview);
		imagePreview.hoverStart(e.currentTarget as Element, () =>
			url ? Promise.resolve(url) : (readString?.(row.path) ?? Promise.resolve(null)),
		);
	}

	function onRowClick(i: number, row: Row) {
		onSelect(i);
		if (row.variant === 'content' && isExpandable(row)) {
			onToggle(i);
		}
	}

	function onRowContext(e: MouseEvent, i: number, row: Row) {
		if (row.variant !== 'content') return;
		e.preventDefault();
		e.stopPropagation();
		onSelect(i);
		onRowMenu(i, e.clientX, e.clientY);
	}

	function onTriggerClick(e: MouseEvent, i: number, row: Row) {
		if (row.variant !== 'content') return;
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		onRowMenu(i, rect.right, rect.bottom);
	}

	const editable = $derived(!readOnly && !!onRowAction);

	function onRowDblClick(e: MouseEvent, i: number, row: Row) {
		if (!editable || row.variant !== 'content') return;
		const part = (e.target as Element).closest('.k, .v:not(.url)');
		if (!part) return;
		const action = editActionFor(row, part.classList.contains('k') ? 'key' : 'value');
		if (action) onRowAction?.(i, action);
	}

	function onRowKeydown(e: KeyboardEvent, i: number, row: Row) {
		if (row.variant !== 'content') return;
		if (e.key.toLowerCase() === 'q' && e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			onRowMenu(i, rect.left + 100, rect.bottom);
			return;
		}
		if (e.key === 'F2' && editable) {
			const action = editActionFor(row, 'value') ?? editActionFor(row, 'key');
			if (!action) return;
			e.preventDefault();
			onRowAction?.(i, action);
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onRowClick(i, row);
		}
	}

	const DRAG_THRESHOLD = 4; // px of movement before a grip press counts as a drag

	interface DragState {
		index: number; // flat-list index of the dragged content row
		pointerId: number;
		startY: number;
		lastY: number;
		moved: boolean;
	}
	let drag = $state<DragState | null>(null);
	let dropTarget = $state<{ gap: number; y: number; depth: number } | null>(null);

	function onGripDown(e: PointerEvent, i: number) {
		if (readOnly || !onReorder || !s.el) return;
		e.stopPropagation();
		e.preventDefault();
		s.el.setPointerCapture(e.pointerId);
		drag = { index: i, pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY, moved: false };
	}

	function contentY(clientY: number): number {
		const el = s.el!;
		const top = scaledOffset(el.scrollTop, s.viewportHeight, s.totalHeight);
		return clientY - el.getBoundingClientRect().top + top;
	}

	function onDragMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId || !s.el) return;
		drag.lastY = e.clientY;
		if (!drag.moved && Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
		drag.moved = true;
		dropTarget = gapAt(rows, offsets, drag.index, contentY(e.clientY));
		startAutoScroll();
	}

	function onDragUp(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const moved = drag.moved;
		const di = drag.index;
		const target = dropTarget;
		drag = null;
		dropTarget = null;
		stopAutoScroll();
		if (!moved || !target) return;
		const dragged = rows[di];
		if (dragged?.variant === 'content') onReorder?.(dragged, target.gap);
	}

	function onDragCancel() {
		drag = null;
		dropTarget = null;
		stopAutoScroll();
	}

	const autoScroller = createAutoScroller({
		scroller: () => s.el,
		axis: 'vertical',
		pointer: () => drag?.lastY ?? 0,
		active: () => !!drag?.moved && !!s.el,
		edgeZone: ROW_DRAG_EDGE_ZONE,
		maxStep: ROW_DRAG_MAX_STEP,
		onTick: () => {
			if (!drag || !s.el) return;
			dropTarget = gapAt(rows, offsets, drag.index, contentY(drag.lastY));
		},
	});
	const startAutoScroll = () => autoScroller.start();
	const stopAutoScroll = () => autoScroller.stop();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="scroller"
	class:dragging={!!drag}
	class:editable
	use:s.attach
	onpointermove={onDragMove}
	onpointerup={onDragUp}
	onpointercancel={onDragCancel}
>
	<div class="spacer" style="height: {contentHeight}px; width: max(100%, {maxRowCh}ch);">
		{#if dropTarget}
			<div
				class="drop-line"
				style="top: {dropTarget.y - s.shift}px; left: calc(0.5rem + {dropTarget.depth} * 1.2rem);"
			></div>
		{/if}
		{#each visibleRows as row, j (rowKey(row) + '@' + (startIndex + j))}
			{@const i = startIndex + j}
			{#if isContent(row)}
				{@const expandable = isExpandable(row)}
				{@const url = row.kind === 'string' ? detectUrl(row.preview) : null}
				{@const image = row.kind === 'string' && mayBeImage(url ?? row.preview.slice(1))}
				{@const selected = i === selectedIndex}
				{@const diff = diffHighlights?.get(pathKey(row.path))}
				{@const invalid = invalidMarks?.get(pathKey(row.path))}
				{@const cut = cutKey !== null && pathKey(row.path) === cutKey}

				<div
					class="r"
					class:expandable
					class:selected
					class:dragging={drag?.index === i}
					class:cut
					data-diff={diff}
					data-invalid={invalid}
					data-ri={i}
					style="transform: translate3d(0, {s.offsetAt(i) - s.shift}px, 0);"
					role="button"
					tabindex={0}
					onclick={() => onRowClick(i, row)}
					ondblclick={(e) => onRowDblClick(e, i, row)}
					oncontextmenu={(e) => onRowContext(e, i, row)}
					onkeydown={(e) => onRowKeydown(e, i, row)}
				>
					{#if !readOnly && onReorder && row.depth > 0}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<span
							class="grip"
							role="button"
							tabindex={-1}
							aria-label="Drag to reorder"
							title="Drag to reorder"
							onpointerdown={(e) => onGripDown(e, i)}
							onclick={(e) => e.stopPropagation()}><Icon icon={GripVertical} size="xs" /></span
						>
					{/if}
					{#each Array.from({ length: row.depth }) as _, g (g)}
						<span class="guide"></span>
					{/each}
					<span class="caret"
						>{#if expandable}<Icon
								icon={row.expanded ? ChevronDown : ChevronRight}
								size="xs"
							/>{/if}</span
					>
					{#if editing?.field === 'key' && editingKey === pathKey(row.path)}
						<InlineCellEditor
							field="key"
							buffer={editing.buffer}
							kind={row.kind}
							onInput={onEditInput}
							onCommit={onEditCommit}
							onCancel={onEditCancel}
						/>
					{:else}
						<span class="k" class:idx={typeof row.key === 'number'}>{renderKey(row)}</span>
					{/if}
					{#if row.depth > 0 || row.kind !== 'object'}<span class="colon">:</span>{/if}
					{#if editing?.field === 'value' && editingKey === pathKey(row.path)}
						<InlineCellEditor
							field="value"
							buffer={editing.buffer}
							kind={row.kind}
							onInput={onEditInput}
							onCommit={onEditCommit}
							onCancel={onEditCancel}
						/>
					{:else if row.expanded && (row.kind === 'object' || row.kind === 'array')}
						<span class="bracket open">{openBracket(row)}</span>
					{:else if chipText(row)}
						<span class="chip {row.kind}">{chipText(row)}</span>
					{:else if url}
						<a
							class="v string url"
							href={url}
							onclick={(e) => onUrlClick(e, url)}
							onpointerenter={image ? (e) => onImageHover(e, row) : undefined}
							onpointerleave={image ? imagePreview.hoverEnd : undefined}>{row.preview}</a
						>
					{:else}
						<span
							class="v {row.kind}"
							onpointerenter={image ? (e) => onImageHover(e, row) : undefined}
							onpointerleave={image ? imagePreview.hoverEnd : undefined}>{row.preview}</span
						>
					{/if}
					{#if !readOnly}
						<button
							class="trigger"
							title={`Open row menu (${fmtKbd('⌃Q')} · right-click)`}
							onclick={(e) => onTriggerClick(e, i, row)}
							><Icon icon={MoreHorizontal} size="xs" /></button
						>
					{/if}
				</div>
			{:else if isPlaceholder(row)}
				<div
					class="r placeholder"
					data-ri={i}
					style="transform: translate3d(0, {s.offsetAt(i) - s.shift}px, 0);"
				>
					{#each Array.from({ length: row.depth }) as _, g (g)}
						<span class="guide"></span>
					{/each}
					<span class="caret"> </span>
					<span class="ph"><Icon icon={MoreHorizontal} size="xs" /></span>
					<span class="ph-label">Loading [{row.index}]</span>
				</div>
			{:else if isVGap(row)}{:else}
				<div
					class="r close"
					data-ri={i}
					style="transform: translate3d(0, {s.offsetAt(i) - s.shift}px, 0);"
				>
					{#each Array.from({ length: row.depth }) as _, g (g)}
						<span class="guide"></span>
					{/each}
					<span class="caret"> </span>
					<span class="bracket close-bracket">{row.bracket}</span>
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.scroller {
		flex: 1;
		overflow: auto;
		position: relative;
	}
	.spacer {
		position: relative;

		contain: layout style;
	}

	.r {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;

		contain: layout style paint;
		will-change: transform;

		min-height: 22px;
		display: flex;
		align-items: flex-start;
		gap: var(--space-xs);
		padding: 2px 0.5rem;
		font-size: var(--font-size-base);
		line-height: 18px;
	}
	.r.expandable {
		cursor: pointer;
	}
	.r:hover {
		background: var(--bg-elev);
	}
	.r.selected {
		background: var(--accent-soft);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.r.selected:hover {
		background: var(--accent-fill);
	}
	/* A preceding .guide means depth > 0: the root key is not editable. */
	.scroller.editable .guide ~ .k:not(.idx),
	.scroller.editable .v:not(.url) {
		cursor: text;
	}

	.r.cut {
		opacity: 0.45;
	}
	.r.cut .v,
	.r.cut .k {
		text-decoration: line-through;
		text-decoration-color: var(--text-faint);
	}

	.r[data-diff='added'] {
		background: var(--success-soft);
		box-shadow: inset 2px 0 0 var(--success);
	}
	.r[data-diff='removed'] {
		background: var(--danger-soft);
		box-shadow: inset 2px 0 0 var(--danger);
	}
	.r[data-diff='changed'] {
		background: var(--warning-soft);
		box-shadow: inset 2px 0 0 var(--warning);
	}
	.r[data-diff='moved'] {
		background: var(--moved-soft);
		box-shadow: inset 2px 0 0 var(--syntax-boolean);
	}

	.r[data-invalid='ancestor'] {
		box-shadow: inset 2px 0 0 var(--warning);
	}
	.r[data-invalid='error'] {
		box-shadow: inset 2px 0 0 var(--danger);
	}
	.r[data-invalid='error'] .v,
	.r[data-invalid='error'] .k {
		text-decoration: underline wavy var(--danger);
		text-decoration-skip-ink: none;
		text-underline-offset: 3px;
	}

	.r[data-invalid='stale-ancestor'] {
		box-shadow: inset 2px 0 0 var(--text-faint);
	}
	.r[data-invalid='stale-error'] {
		box-shadow: inset 2px 0 0 var(--text-faint);
	}
	.r[data-invalid='stale-error'] .v,
	.r[data-invalid='stale-error'] .k {
		text-decoration: underline wavy var(--text-faint);
		text-decoration-skip-ink: none;
		text-underline-offset: 3px;
	}

	.guide {
		display: inline-block;
		flex-shrink: 0;
		width: 1.2rem;
		height: 100%;
		border-right: 1px solid transparent;
	}
	.r .guide {
		border-right-color: var(--text-ghost);
	}
	.r:hover .guide {
		border-right-color: var(--rule-2);
	}
	.r.selected .guide {
		border-right-color: var(--rule-2);
	}

	.caret {
		display: inline-block;
		width: 1ch;
		color: var(--text-faint);
		flex-shrink: 0;
		text-align: center;
	}

	.r.expandable .caret {
		color: var(--text-dim);
	}
	.r.selected .caret {
		color: var(--accent);
	}

	.k {
		color: var(--text);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.k.idx {
		color: var(--text-dim);
	}
	.colon {
		color: var(--syntax-punct);
		flex-shrink: 0;
		padding-right: var(--space-xs);
		white-space: nowrap;
	}

	.v {
		flex: 1;
		min-width: 0;
		/* One clipped line per value: keeps every row a uniform height so the
		   variable-height measurement loop has nothing to thrash on. A long or
		   newline-containing value (common in large docs) would otherwise render
		   as a tall multi-line row and stall the tree. */
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.v.string {
		color: var(--syntax-string);
	}
	.v.number {
		color: var(--syntax-number);
	}
	.v.boolean {
		color: var(--syntax-boolean);
	}
	.v.null {
		color: var(--syntax-null);
		font-style: italic;
	}
	.v.url {
		color: var(--syntax-url);
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1px;
		text-decoration-color: var(--text-faint);
		cursor: pointer;
	}
	.v.url:hover {
		text-decoration-color: var(--accent);
		color: var(--accent);
	}

	.bracket {
		color: var(--syntax-punct);
		flex-shrink: 0;
	}
	.bracket.open {
		color: var(--syntax-punct);
	}
	.bracket.close-bracket {
		color: var(--syntax-punct);
	}

	.chip {
		display: inline-block;
		color: var(--text-dim);
		background: var(--bg-elev-3);
		border: 1px solid var(--rule-2);
		padding: 0 var(--space-sm);
		font-size: var(--font-size-sm);
		flex-shrink: 0;
	}

	.trigger {
		visibility: hidden;
		flex-shrink: 0;

		position: sticky;
		right: 0.5rem;

		margin-left: auto;
		background: transparent;
		border: 1px solid var(--rule);
		color: var(--text-dim);
		padding: 0 var(--space-xs);
		font: inherit;
		font-size: var(--font-size-sm);
		line-height: 1;
		cursor: pointer;
	}
	.r:hover .trigger,
	.r.selected .trigger {
		visibility: visible;
	}
	.trigger:hover {
		background: var(--bg-elev);
		color: var(--text);
		border-color: var(--rule-2);
	}

	.grip {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-dim);
		font-size: var(--font-size-sm);
		line-height: 1;
		cursor: grab;
		visibility: hidden;
		touch-action: none;
		user-select: none;
	}
	.r:hover .grip,
	.r.selected .grip {
		visibility: visible;
	}
	.grip:hover {
		color: var(--text);
	}
	.scroller.dragging .grip {
		cursor: grabbing;
	}
	.r.dragging {
		opacity: 0.45;
	}
	.drop-line {
		position: absolute;
		right: 0.5rem;
		height: 2px;
		background: var(--accent);
		pointer-events: none;
		z-index: 5;
		transform: translateY(-1px);
	}
	.drop-line::before {
		content: '';
		position: absolute;
		left: -3px;
		top: -2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}

	.ph {
		color: var(--text-faint);
		flex-shrink: 0;
	}
	.ph-label {
		color: var(--text-dim);
		font-size: var(--font-size-xs);
		letter-spacing: 0.04em;
	}
</style>
