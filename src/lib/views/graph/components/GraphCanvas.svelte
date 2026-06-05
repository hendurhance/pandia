<script module lang="ts">
	import type { Path } from '$lib/ipc/types';
	import type { ViewportState } from '../logic/viewport';

	
	export interface GraphCanvasApi {
		fitView: () => void;
		zoomBy: (factor: number) => void;
		centerOn: (worldX: number, worldY: number) => void;
		viewport: () => ViewportState;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { CardRow, LayoutResult } from '../logic/layout';
	import { paintFrame } from '../logic/render';
	import { readGraphTheme, type GraphTheme } from '../logic/theme';
	import { APPEARANCE_CHANGE_EVENT } from '$lib/shell/logic/theme';
	import {
		centerOn as centerOnViewport,
		fitToContent,
		hitTest,
		pan as panViewport,
		screenToWorld,
		zoomAt,
		type HitTarget,
	} from '../logic/viewport';

	interface Props {
		layout: LayoutResult;
		
		onPickCard: (path: Path) => void;
		
		onPortToggle: (row: CardRow) => void;
		
		onScaleChange?: (scale: number) => void;
		
		onReady?: (api: GraphCanvasApi | null) => void;
		
		highlightCardId?: string | null;
		
		edgeStyle?: 'elbow' | 'curve';
	}

	let {
		layout,
		onPickCard,
		onPortToggle,
		onScaleChange,
		onReady,
		highlightCardId = null,
		edgeStyle = 'elbow',
	}: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let ctx: CanvasRenderingContext2D | null = null;

	let screenW = 0;
	let screenH = 0;
	let dpr = 1;

	let viewport = $state<ViewportState>({ tx: 40, ty: 40, scale: 1 });

	let theme: GraphTheme | null = null;

	let pendingFrame = 0;
	function requestPaint() {
		if (pendingFrame || !ctx || !theme) return;
		pendingFrame = requestAnimationFrame(() => {
			pendingFrame = 0;
			if (!ctx || !theme || !canvas) return;
			paintFrame({
				ctx,
				layout,
				viewport,
				screenW,
				screenH,
				theme,
				dpr,
				highlightCardId,
				edgeStyle,
			});
		});
	}

	$effect(() => {
		void layout;
		void viewport;
		void highlightCardId;
		void edgeStyle;
		requestPaint();
	});

	$effect(() => {
		onScaleChange?.(viewport.scale);
	});

	function syncCanvasSize() {
		if (!host || !canvas) return;
		const newW = host.clientWidth;
		const newH = host.clientHeight;
		const newDpr = window.devicePixelRatio || 1;
		if (newW === screenW && newH === screenH && newDpr === dpr) return;
		screenW = newW;
		screenH = newH;
		dpr = newDpr;
		canvas.width = Math.max(1, Math.round(screenW * dpr));
		canvas.height = Math.max(1, Math.round(screenH * dpr));
		canvas.style.width = `${screenW}px`;
		canvas.style.height = `${screenH}px`;
		requestPaint();
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const factor = Math.exp(-e.deltaY * 0.012);
			zoomAtScreenPoint(e.clientX, e.clientY, factor);
		} else {
			viewport = panViewport(viewport, -e.deltaX, -e.deltaY);
		}
	}

	function zoomAtScreenPoint(clientX: number, clientY: number, factor: number) {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		viewport = zoomAt(viewport, clientX - rect.left, clientY - rect.top, factor);
	}

	let panStart: { sx: number; sy: number; tx: number; ty: number; pointerId: number } | null = null;
	let panMoved = false;

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const hit = hitAtScreen(e.clientX - rect.left, e.clientY - rect.top);
		if (hit?.kind === 'port') {
			onPortToggle(hit.row);
			return;
		}
		panStart = {
			sx: e.clientX,
			sy: e.clientY,
			tx: viewport.tx,
			ty: viewport.ty,
			pointerId: e.pointerId,
		};
		panMoved = false;
		canvas.setPointerCapture(e.pointerId);
		canvas.style.cursor = 'grabbing';
	}

	const PAN_THRESHOLD_PX = 4;
	function onPointerMove(e: PointerEvent) {
		if (panStart) {
			const dx = e.clientX - panStart.sx;
			const dy = e.clientY - panStart.sy;
			if (!panMoved && Math.abs(dx) + Math.abs(dy) < PAN_THRESHOLD_PX) return;
			panMoved = true;
			viewport = { tx: panStart.tx + dx, ty: panStart.ty + dy, scale: viewport.scale };
		} else if (canvas) {
			const rect = canvas.getBoundingClientRect();
			const hit = hitAtScreen(e.clientX - rect.left, e.clientY - rect.top);
			canvas.style.cursor = hit && hit.kind !== 'card' ? 'pointer' : 'grab';
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!canvas) return;
		const wasPanning = panStart !== null;
		const moved = panMoved;
		if (panStart) {
			try {
				canvas.releasePointerCapture(panStart.pointerId);
			} catch {
				
			}
			panStart = null;
			panMoved = false;
		}
		if (wasPanning && !moved) {
			const rect = canvas.getBoundingClientRect();
			const hit = hitAtScreen(e.clientX - rect.left, e.clientY - rect.top);
			if (hit?.kind === 'title') onPickCard(hit.card.path);
		}
		canvas.style.cursor = 'grab';
	}

	function onDblClick(e: MouseEvent) {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const hit = hitAtScreen(e.clientX - rect.left, e.clientY - rect.top);
		if (hit?.kind === 'title') {
			onPickCard(hit.card.path);
			return;
		}
		zoomAtScreenPoint(e.clientX, e.clientY, 1.4);
	}

	function hitAtScreen(sx: number, sy: number): HitTarget {
		const w = screenToWorld(viewport, sx, sy);
		return hitTest(layout, w.x, w.y);
	}

	function fitView() {
		if (layout.width === 0 || layout.height === 0 || screenW === 0 || screenH === 0) return;
		viewport = fitToContent({ w: layout.width, h: layout.height }, { w: screenW, h: screenH });
	}

	function zoomBy(factor: number) {
		zoomAtScreenPoint(screenW / 2, screenH / 2, factor);
	}

	function centerOn(worldX: number, worldY: number) {
		if (screenW === 0 || screenH === 0) return;
		viewport = centerOnViewport(viewport, worldX, worldY, screenW, screenH);
	}

	const api: GraphCanvasApi = {
		fitView,
		zoomBy,
		centerOn,
		viewport: () => viewport,
	};

	onMount(() => {
		if (!canvas || !host) return;
		ctx = canvas.getContext('2d');
		theme = readGraphTheme();
		syncCanvasSize();

		const ro = new ResizeObserver(() => {
			syncCanvasSize();
			theme = readGraphTheme();
			requestPaint();
		});
		ro.observe(host);

		const onDprChange = () => syncCanvasSize();
		window.addEventListener('resize', onDprChange);

		const onAppearanceChange = () => {
			theme = readGraphTheme();
			requestPaint();
		};
		window.addEventListener(APPEARANCE_CHANGE_EVENT, onAppearanceChange);

		onReady?.(api);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', onDprChange);
			window.removeEventListener(APPEARANCE_CHANGE_EVENT, onAppearanceChange);
			if (pendingFrame) cancelAnimationFrame(pendingFrame);
			pendingFrame = 0;
			ctx = null;
			theme = null;
			onReady?.(null);
		};
	});
</script>

<div
	class="host"
	bind:this={host}
	role="application"
	aria-label="JSON graph view"
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={onDblClick}
>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
	.host {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	canvas {
		display: block;
		cursor: grab;
		touch-action: none; 
		user-select: none;
		outline: none;
	}
</style>
