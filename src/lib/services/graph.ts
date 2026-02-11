import { isPlainObject } from '../utils/error';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { documentDir } from '@tauri-apps/api/path';

/** Supported layout orientations */
export type LayoutMode = 'horizontal' | 'vertical';

/** Node types based on JSON value structure */
export type NodeType = 'object' | 'array' | 'primitive';

/** Primitive JSON value types */
export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';

/** ViewBox state for SVG pan/zoom */
export interface ViewBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Point in 2D space */
export interface Point {
	readonly x: number;
	readonly y: number;
}

/** Dimensions of a rectangular element */
export interface Dimensions {
	readonly width: number;
	readonly height: number;
}

/** A row in an object/array node display */
export interface NodeRow {
	readonly key: string;
	readonly value: unknown;
	readonly displayValue: string;
}

/** JSON node structure for graph visualization */
export interface JsonNode {
	readonly id: string;
	readonly label: string;
	readonly value: unknown;
	readonly type: NodeType;
	readonly dataType: string;
	readonly level: number;
	readonly parent: JsonNode | null;
	readonly children: JsonNode[];
	readonly isExpanded: boolean;
	readonly path: string;
	x: number;
	y: number;
	readonly width: number;
	readonly height: number;
}

/** Truncated value with both short and full representations */
export interface TruncatedValue {
	readonly truncated: string;
	readonly full: string;
}

// Constants

/** Default node dimensions and spacing */
export const NODE_DIMENSIONS = {
	MIN_WIDTH: 180,
	MAX_WIDTH: 320,
	MIN_HEIGHT: 60,
	ROW_HEIGHT: 24,
	MAX_ROWS: 8,
	MAX_LABEL_LENGTH: 20,
	MAX_VALUE_LENGTH: 25,
	CHAR_WIDTH: 7, // Approximate width of monospace char at 11px
	PADDING: 24, // Left + right padding (12 each)
	KEY_VALUE_GAP: 16, // Minimum gap between key and value
} as const;

/** Layout spacing configuration */
export const LAYOUT_SPACING = {
	HORIZONTAL: 320,
	VERTICAL: 120,
	LEVEL: 250,
	MIN_ADAPTIVE: 40,
	GROUP_GAP: 150,
	MARGIN: 80,
} as const;

/** Graph traversal limits for performance */
export const GRAPH_LIMITS = {
	MAX_DEPTH: 6,
	MAX_CHILDREN: 15,
	ARRAY_SAMPLE_SIZE: 8,
} as const;

/** Default viewBox dimensions */
export const DEFAULT_VIEWBOX: ViewBox = {
	x: 0,
	y: 0,
	width: 1200,
	height: 800,
} as const;

/** Zoom constraints */
export const ZOOM_LIMITS = {
	MIN: 0.2,
	MAX: 5,
	STEP: 1.1,
} as const;

/** Color palette for different value types */
export const TYPE_COLORS: Readonly<Record<string, string>> = {
	string: '#a5d6ff',
	number: '#79c0ff',
	boolean: '#ffa657',
	null: '#ff7b72',
	object: '#f0f6fc',
	array: '#ec4899',
} as const;

// Type Guards

/** Check if value is a primitive type */
export function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
	return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

// Node Type Detection

/** Determine the node type from a value */
export function getNodeType(value: unknown): NodeType {
	if (Array.isArray(value)) return 'array';
	if (isPlainObject(value)) return 'object';
	return 'primitive';
}

/** Get a human-readable data type string */
export function getDataType(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (Array.isArray(value)) return `Array[${value.length}]`;
	if (isPlainObject(value)) return 'Object';
	return typeof value;
}

/** Get the color for a value type */
export function getTypeColor(value: unknown): string {
	if (value === null) return TYPE_COLORS.null;
	if (Array.isArray(value)) return TYPE_COLORS.array;
	if (isPlainObject(value)) return TYPE_COLORS.object;
	
	const typeKey = typeof value;
	return TYPE_COLORS[typeKey] ?? TYPE_COLORS.object;
}

// Display Formatting

/** Format a value for display with optional truncation */
export function formatDisplayValue(value: unknown, maxLength = NODE_DIMENSIONS.MAX_VALUE_LENGTH): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	
	if (typeof value === 'string') {
		const truncated = value.length > maxLength 
			? `${value.substring(0, maxLength)}...` 
			: value;
		return `"${truncated}"`;
	}
	
	if (Array.isArray(value)) {
		return `Array[${value.length}]`;
	}
	
	if (isPlainObject(value)) {
		return `Object{${Object.keys(value).length}}`;
	}
	
	return String(value);
}

/** Truncate a value for preview display */
export function truncateValue(value: unknown, maxLength = 300): TruncatedValue {
	let fullText: string;
	
	if (value === null) {
		fullText = 'null';
	} else if (value === undefined) {
		fullText = 'undefined';
	} else if (typeof value === 'string') {
		fullText = `"${value}"`;
	} else if (typeof value === 'number' || typeof value === 'boolean') {
		fullText = String(value);
	} else {
		fullText = JSON.stringify(value, null, 2);
	}
	
	const truncated = fullText.length > maxLength 
		? `${fullText.substring(0, maxLength)}...` 
		: fullText;
	
	return { truncated, full: fullText };
}

/** Generate rows for object/array display */
export function getNodeRows(value: unknown, type: NodeType): readonly NodeRow[] {
	const rows: NodeRow[] = [];
	
	if (type === 'object' && isPlainObject(value)) {
		const entries = Object.entries(value).slice(0, GRAPH_LIMITS.ARRAY_SAMPLE_SIZE);
		for (const [key, val] of entries) {
			rows.push({
				key,
				value: val,
				displayValue: formatDisplayValue(val),
			});
		}
	} else if (type === 'array' && Array.isArray(value)) {
		const items = value.slice(0, GRAPH_LIMITS.ARRAY_SAMPLE_SIZE);
		items.forEach((val, index) => {
			rows.push({
				key: String(index),
				value: val,
				displayValue: formatDisplayValue(val),
			});
		});
	}
	
	return rows;
}

// Node Dimension Calculation

/** Calculate the optimal width for a node based on its content */
export function calculateNodeWidth(value: unknown, type: NodeType, label: string): number {
	const { MIN_WIDTH, MAX_WIDTH, CHAR_WIDTH, PADDING, KEY_VALUE_GAP } = NODE_DIMENSIONS;

	// Start with minimum width needed for the label
	let maxRowWidth = label.length * CHAR_WIDTH + PADDING;

	if (type === 'primitive') {
		const displayValue = formatDisplayValue(value);
		const primitiveWidth = displayValue.length * CHAR_WIDTH + PADDING;
		return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, primitiveWidth));
	}

	// Calculate width needed for each row (key + value)
	const rows = getNodeRows(value, type);
	for (const row of rows) {
		const keyText = type === 'array' ? `[${row.key}]` : `${row.key}:`;
		const rowWidth = (keyText.length + row.displayValue.length) * CHAR_WIDTH + PADDING + KEY_VALUE_GAP;
		maxRowWidth = Math.max(maxRowWidth, rowWidth);
	}

	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, maxRowWidth));
}

/** Calculate the height of a node based on its content */
export function calculateNodeHeight(value: unknown, type: NodeType): number {
	if (type === 'primitive') return NODE_DIMENSIONS.MIN_HEIGHT;

	let rowCount = 0;

	if (Array.isArray(value)) {
		rowCount = Math.min(value.length, NODE_DIMENSIONS.MAX_ROWS);
	} else if (isPlainObject(value)) {
		rowCount = Math.min(Object.keys(value).length, NODE_DIMENSIONS.MAX_ROWS);
	}

	return NODE_DIMENSIONS.MIN_HEIGHT + (rowCount * NODE_DIMENSIONS.ROW_HEIGHT);
}

// JSON Path Generation

/** Generate JSONPath expression for a node */
export function generateJsonPath(node: JsonNode): string {
	if (!node.parent) return '$';
	
	const pathParts: string[] = [];
	let current: JsonNode | null = node;
	
	while (current?.parent) {
		if (current.parent.type === 'array') {
			pathParts.unshift(`[${current.label}]`);
		} else {
			pathParts.unshift(`["${current.label}"]`);
		}
		current = current.parent;
	}
	
	return '$' + pathParts.join('');
}

// Graph Generation

/** Create a new JSON node */
export function createNode(
	id: string,
	label: string,
	value: unknown,
	level: number,
	parent: JsonNode | null,
	path: string
): JsonNode {
	const type = getNodeType(value);

	return {
		id,
		label,
		value,
		type,
		dataType: getDataType(value),
		level,
		parent,
		children: [],
		isExpanded: type !== 'primitive' && level < GRAPH_LIMITS.MAX_DEPTH,
		path,
		x: 0,
		y: 0,
		width: calculateNodeWidth(value, type, label),
		height: calculateNodeHeight(value, type),
	};
}

/** Generate all nodes from parsed JSON data */
export function generateNodes(data: unknown): JsonNode[] {
	if (data === null || data === undefined) return [];
	
	const nodes: JsonNode[] = [];
	const rootNode = createNode('root', 'root', data, 0, null, '');
	nodes.push(rootNode);
	
	generateChildNodes(rootNode, data, 1, nodes);
	
	return nodes;
}

/** Recursively generate child nodes */
function generateChildNodes(
	parentNode: JsonNode,
	data: unknown,
	level: number,
	nodesList: JsonNode[]
): void {
	if (!isPlainObject(data) && !Array.isArray(data)) return;
	if (level > GRAPH_LIMITS.MAX_DEPTH) return;
	
	const entries = Array.isArray(data)
		? data.map((item, index) => [String(index), item] as const)
		: Object.entries(data);
	
	const limitedEntries = entries.slice(0, GRAPH_LIMITS.MAX_CHILDREN);

	for (const [key, value] of limitedEntries) {
		// Skip primitive values - they're shown as rows in the parent node
		const valueType = getNodeType(value);
		if (valueType === 'primitive') continue;

		const nodeId = `${parentNode.id}-${key}`;
		const nodePath = parentNode.path ? `${parentNode.path}.${key}` : key;

		const childNode = createNode(nodeId, key, value, level, parentNode, nodePath);
		nodesList.push(childNode);
		(parentNode.children as JsonNode[]).push(childNode);

		if (childNode.isExpanded) {
			generateChildNodes(childNode, value, level + 1, nodesList);
		}
	}
}

// Layout Positioning

/** Position all nodes in the graph */
export function positionNodes(nodes: JsonNode[], layoutMode: LayoutMode): void {
	// Group nodes by level using plain object (preserves insertion order like original)
	const levels: { [key: number]: JsonNode[] } = {};
	nodes.forEach(node => {
		if (!levels[node.level]) levels[node.level] = [];
		levels[node.level].push(node);
	});
	
	// Position root node
	if (levels[0] && levels[0].length > 0) {
		levels[0][0].x = 600;
		levels[0][0].y = 150;
	}
	
	// Position each subsequent level
	const maxLevel = Math.max(...Object.keys(levels).map(Number));
	
	for (let level = 1; level <= maxLevel; level++) {
		if (!levels[level]) continue;
		
		const levelNodes = levels[level];
		
		// Group nodes by parent (using plain object to match original)
		const parentGroups: { [parentId: string]: JsonNode[] } = {};
		levelNodes.forEach(node => {
			const parentId = node.parent?.id || 'root';
			if (!parentGroups[parentId]) parentGroups[parentId] = [];
			parentGroups[parentId].push(node);
		});
		
		// Position each parent's children with improved spacing
		let cumulativeOffset = 0;
		Object.entries(parentGroups).forEach(([parentId, children], groupIndex) => {
			const parent = nodes.find(n => n.id === parentId);
			if (!parent) return;
			
			// Calculate initial positions for this parent's children
			calculateInitialPositions(parent, children, layoutMode);
			
			// Apply offset to avoid overlaps between different parent groups
			if (groupIndex > 0) {
				applyGroupOffset(children, cumulativeOffset, layoutMode);
			}
			
			// Calculate offset for next group based on current group's extent
			if (children.length > 0) {
				if (layoutMode === 'vertical') {
					const maxChildX = Math.max(...children.map(c => c.x + c.width));
					const minChildX = Math.min(...children.map(c => c.x));
					const groupWidth = maxChildX - minChildX;
					cumulativeOffset += groupWidth + LAYOUT_SPACING.GROUP_GAP;
				} else {
					const maxChildY = Math.max(...children.map(c => c.y + c.height));
					const minChildY = Math.min(...children.map(c => c.y));
					const groupHeight = maxChildY - minChildY;
					cumulativeOffset += groupHeight + LAYOUT_SPACING.GROUP_GAP;
				}
			}
		});
	}
}

/** Calculate initial positions for children of a parent node */
function calculateInitialPositions(
	parent: JsonNode,
	children: JsonNode[],
	layoutMode: LayoutMode
): void {
	if (children.length === 0) return;
	
	const adaptiveSpacing = calculateAdaptiveSpacing(children.length);
	
	if (layoutMode === 'horizontal') {
		positionHorizontally(parent, children, adaptiveSpacing);
	} else {
		positionVertically(parent, children, adaptiveSpacing);
	}
}

/** Calculate adaptive spacing based on number of children */
function calculateAdaptiveSpacing(childCount: number): number {
	const spacingReduction = Math.min(0.7, childCount * 0.05);
	return Math.max(
		LAYOUT_SPACING.MIN_ADAPTIVE,
		LAYOUT_SPACING.VERTICAL * (1 - spacingReduction)
	);
}

/** Position children horizontally (parent on left, children on right) */
function positionHorizontally(
	parent: JsonNode,
	children: JsonNode[],
	spacing: number
): void {
	const totalHeight = children.reduce((sum, child) => sum + child.height, 0)
		+ (children.length - 1) * spacing;
	
	let currentY = Math.max(
		LAYOUT_SPACING.MARGIN,
		parent.y + parent.height / 2 - totalHeight / 2
	);
	
	for (const child of children) {
		child.x = parent.x + parent.width + LAYOUT_SPACING.LEVEL;
		child.y = currentY;
		currentY += child.height + spacing;
	}
}

/** Position children vertically (parent on top, children below) */
function positionVertically(
	parent: JsonNode,
	children: JsonNode[],
	spacing: number
): void {
	const totalWidth = children.reduce((sum, child) => sum + child.width, 0)
		+ (children.length - 1) * spacing;
	
	let currentX = Math.max(
		LAYOUT_SPACING.MARGIN,
		parent.x + parent.width / 2 - totalWidth / 2
	);
	
	for (const child of children) {
		child.x = currentX;
		child.y = parent.y + parent.height + LAYOUT_SPACING.LEVEL;
		currentX += child.width + spacing;
	}
}

/** Apply offset to avoid overlaps between parent groups */
function applyGroupOffset(
	children: JsonNode[],
	offset: number,
	layoutMode: LayoutMode
): void {
	for (const child of children) {
		if (layoutMode === 'vertical') {
			child.x += offset;
		} else {
			child.y += offset;
		}
	}
}

// SVG Path Generation

/** Generate SVG path for connection between nodes */ 
export function getConnectionPath(
	from: JsonNode,
	to: JsonNode,
	layoutMode: LayoutMode
): string {
	if (layoutMode === 'horizontal') {
		return createHorizontalConnectionPath(from, to);
	}
	return createVerticalConnectionPath(from, to);
}

/** Create horizontal connection path (left to right) */
function createHorizontalConnectionPath(from: JsonNode, to: JsonNode): string {
	const fromX = from.x + from.width;
	const fromY = from.y + from.height / 2;
	const toX = to.x;
	const toY = to.y + to.height / 2;
	const midX = fromX + (toX - fromX) / 2;
	
	return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
}

/** Create vertical connection path (top to bottom) */
function createVerticalConnectionPath(from: JsonNode, to: JsonNode): string {
	const fromX = from.x + from.width / 2;
	const fromY = from.y + from.height;
	const toX = to.x + to.width / 2;
	const toY = to.y;
	const midY = fromY + (toY - fromY) / 2;
	
	return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

// ViewBox Utilities

/** Calculate viewBox centered on root node */
export function calculateCenteredViewBox(rootNode: JsonNode): ViewBox {
	return {
		x: rootNode.x - 400,
		y: rootNode.y - 200,
		width: DEFAULT_VIEWBOX.width,
		height: DEFAULT_VIEWBOX.height,
	};
}

/** Apply zoom to viewBox */
export function applyZoom(
	viewBox: ViewBox,
	scale: number,
	mousePosition: Point,
	zoomFactor: number
): { viewBox: ViewBox; scale: number } {
	const newScale = Math.max(ZOOM_LIMITS.MIN, Math.min(ZOOM_LIMITS.MAX, scale * zoomFactor));
	
	if (newScale === scale) {
		return { viewBox, scale };
	}
	
	const scaleRatio = newScale / scale;
	
	return {
		viewBox: {
			x: mousePosition.x - (mousePosition.x - viewBox.x) / scaleRatio,
			y: mousePosition.y - (mousePosition.y - viewBox.y) / scaleRatio,
			width: viewBox.width / scaleRatio,
			height: viewBox.height / scaleRatio,
		},
		scale: newScale,
	};
}

/** Apply pan to viewBox */
export function applyPan(
	viewBox: ViewBox,
	delta: Point,
	scale: number
): ViewBox {
	return {
		...viewBox,
		x: viewBox.x - delta.x / scale,
		y: viewBox.y - delta.y / scale,
	};
}

// Image Export

/** Bounding box for graph content */
export interface GraphBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly width: number;
	readonly height: number;
}

/** Calculate the bounding box that contains all nodes */
export function calculateGraphBounds(nodes: readonly JsonNode[], padding = 50): GraphBounds {
	if (nodes.length === 0) {
		return {
			minX: 0,
			minY: 0,
			maxX: DEFAULT_VIEWBOX.width,
			maxY: DEFAULT_VIEWBOX.height,
			width: DEFAULT_VIEWBOX.width,
			height: DEFAULT_VIEWBOX.height,
		};
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const node of nodes) {
		minX = Math.min(minX, node.x);
		minY = Math.min(minY, node.y);
		maxX = Math.max(maxX, node.x + node.width);
		maxY = Math.max(maxY, node.y + node.height);
	}

	// Add padding around the content
	minX -= padding;
	minY -= padding;
	maxX += padding;
	maxY += padding;

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/** High resolution export settings */
const EXPORT_CONFIG = {
	/** Target DPI for high-quality print/zoom (300 DPI equivalent) */
	TARGET_DPI: 300,
	/** Base screen DPI */
	BASE_DPI: 96,
	/** Minimum resolution multiplier */
	MIN_MULTIPLIER: 3,
	/** Maximum canvas dimension (browser limit is typically 16384, use 8192 for safety) */
	MAX_CANVAS_DIMENSION: 8192,
	/** Fallback multiplier when graph is very large */
	FALLBACK_MULTIPLIER: 2,
} as const;

/** Export format options */
export type ExportFormat = 'svg' | 'png';

/** Download graph as image using Tauri file dialog */
export async function downloadAsImage(
	svgElement: SVGSVGElement,
	nodes: readonly JsonNode[] = [],
	filename = 'graph-visualizer',
	format: ExportFormat = 'svg'
): Promise<void> {
	// Calculate bounds from all nodes instead of using current viewBox
	const bounds = calculateGraphBounds(nodes);
	const width = bounds.width;
	const height = bounds.height;

	// Clone and prepare SVG for rendering with full graph bounds
	const svgClone = prepareSvgForExport(svgElement, width, height, bounds);

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const docDir = await documentDir();

	if (format === 'svg') {
		// Export as SVG (vector - infinite zoom without blur)
		const svgData = serializeSvgForExport(svgClone);
		const defaultFilename = `${filename}-${timestamp}.svg`;

		const savePath = await save({
			filters: [{ name: 'SVG Image', extensions: ['svg'] }],
			defaultPath: `${docDir}/${defaultFilename}`
		});

		if (savePath) {
			const encoder = new TextEncoder();
			await writeFile(savePath, encoder.encode(svgData));
		}
	} else {
		// Export as PNG (raster)
		const pngData = await renderSvgToCanvas(svgClone, width, height);
		const defaultFilename = `${filename}-${timestamp}.png`;

		const savePath = await save({
			filters: [{ name: 'PNG Image', extensions: ['png'] }],
			defaultPath: `${docDir}/${defaultFilename}`
		});

		if (savePath) {
			await writeFile(savePath, pngData);
		}
	}
}

/** Serialize SVG to string for export */
function serializeSvgForExport(svgClone: SVGSVGElement): string {
	const serializer = new XMLSerializer();
	let svgString = serializer.serializeToString(svgClone);

	// Add XML declaration
	if (!svgString.startsWith('<?xml')) {
		svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
	}

	// Add embedded styles for standalone viewing
	const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
	styleElement.textContent = `
		text { font-family: system-ui, -apple-system, sans-serif; }
		.node { cursor: pointer; }
	`;

	return svgString;
}

/** Prepare SVG element for export by resolving CSS variables */
function prepareSvgForExport(
	svgElement: SVGSVGElement,
	width: number,
	height: number,
	bounds?: GraphBounds
): SVGSVGElement {
	const svgClone = svgElement.cloneNode(true) as SVGSVGElement;

	// Set explicit dimensions
	svgClone.setAttribute('width', String(width));
	svgClone.setAttribute('height', String(height));
	svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

	// Set viewBox to show the full graph content (not just the visible area)
	if (bounds) {
		svgClone.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);

		// Fix background rectangles that use 100% width/height - they need explicit coordinates
		fixBackgroundRects(svgClone, bounds);
	}

	// Remove problematic attributes
	svgClone.removeAttribute('class');
	svgClone.style.cssText = '';

	// Resolve CSS variables to actual color values
	resolveCssVariablesInElement(svgClone);

	return svgClone;
}

/** Fix background rectangles to use explicit bounds instead of 100% */
function fixBackgroundRects(svgClone: SVGSVGElement, bounds: GraphBounds): void {
	// Find all direct child rects that might be backgrounds (100% width/height)
	const rects = svgClone.querySelectorAll('rect');

	for (const rect of rects) {
		const widthAttr = rect.getAttribute('width');
		const heightAttr = rect.getAttribute('height');

		// Check if this is a background rect (uses 100% or has no explicit position)
		if (widthAttr === '100%' || heightAttr === '100%') {
			// Set explicit coordinates matching the viewBox bounds
			rect.setAttribute('x', String(bounds.minX));
			rect.setAttribute('y', String(bounds.minY));
			rect.setAttribute('width', String(bounds.width));
			rect.setAttribute('height', String(bounds.height));
		}
	}
}

/** Calculate optimal scale factor for high-quality export within canvas limits */
function calculateOptimalScaleFactor(width: number, height: number): number {
	// Calculate ideal scale for 300 DPI equivalent
	const idealScale = EXPORT_CONFIG.TARGET_DPI / EXPORT_CONFIG.BASE_DPI;

	// Check if ideal scale would exceed canvas limits
	const scaledWidth = width * idealScale;
	const scaledHeight = height * idealScale;

	if (scaledWidth <= EXPORT_CONFIG.MAX_CANVAS_DIMENSION &&
		scaledHeight <= EXPORT_CONFIG.MAX_CANVAS_DIMENSION) {
		// Can use ideal scale
		return Math.max(idealScale, EXPORT_CONFIG.MIN_MULTIPLIER);
	}

	// Calculate maximum safe scale factor
	const maxScaleByWidth = EXPORT_CONFIG.MAX_CANVAS_DIMENSION / width;
	const maxScaleByHeight = EXPORT_CONFIG.MAX_CANVAS_DIMENSION / height;
	const maxSafeScale = Math.min(maxScaleByWidth, maxScaleByHeight);

	// Use the highest safe scale, but at least the fallback
	return Math.max(maxSafeScale, EXPORT_CONFIG.FALLBACK_MULTIPLIER);
}

/** Render SVG to canvas and return PNG data as Uint8Array */
async function renderSvgToCanvas(
	svgClone: SVGSVGElement,
	width: number,
	height: number
): Promise<Uint8Array> {
	// Serialize to string
	const serializer = new XMLSerializer();
	let svgString = serializer.serializeToString(svgClone);
	svgString = cleanSvgString(svgString);

	// Calculate optimal scale factor for crisp output
	const scaleFactor = calculateOptimalScaleFactor(width, height);

	// Create canvas with high resolution
	const canvas = document.createElement('canvas');
	canvas.width = Math.min(width * scaleFactor, EXPORT_CONFIG.MAX_CANVAS_DIMENSION);
	canvas.height = Math.min(height * scaleFactor, EXPORT_CONFIG.MAX_CANVAS_DIMENSION);

	// Calculate actual scale used (may be limited by canvas size)
	const actualScaleX = canvas.width / width;
	const actualScaleY = canvas.height / height;
	const actualScale = Math.min(actualScaleX, actualScaleY);

	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not get canvas context');

	// Enable high-quality image rendering
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.scale(actualScale, actualScale);

	// Load SVG as image using data URL (avoids blob URL navigation issues)
	// Convert to base64 - handle UTF-8 encoding properly for large strings
	const base64Svg = stringToBase64(svgString);
	const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

	const img = await loadImage(dataUrl);

	// Draw background and SVG
	ctx.fillStyle = CSS_FALLBACKS['--graph-background'];
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(img, 0, 0, width, height);

	// Convert to PNG blob and then to Uint8Array
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			async (blob) => {
				if (blob) {
					const arrayBuffer = await blob.arrayBuffer();
					resolve(new Uint8Array(arrayBuffer));
				} else {
					reject(new Error('Failed to create PNG blob'));
				}
			},
			'image/png',
			1.0
		);
	});
}

/** Load an image from URL */
function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load SVG as image'));
		img.src = url;
	});
}

/** Convert string to base64, handling UTF-8 encoding properly for large strings */
function stringToBase64(str: string): string {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(str);
	// Process in chunks to avoid call stack size limits
	const chunkSize = 8192;
	let result = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.slice(i, i + chunkSize);
		result += String.fromCharCode(...chunk);
	}
	return btoa(result);
}

/** Clean SVG string for proper rendering */
function cleanSvgString(svgString: string): string {
	// Ensure proper XML declaration
	if (!svgString.startsWith('<?xml')) {
		svgString = '<?xml version="1.0" encoding="UTF-8"?>' + svgString;
	}
	
	// Remove any remaining unresolved CSS variables
	svgString = svgString.replace(/var\([^)]+\)/g, '#000000');
	
	return svgString;
}

/** CSS variable fallback values */
const CSS_FALLBACKS: Record<string, string> = {
	'--graph-background': '#0d1117',
	'--graph-surface': '#1a202c',
	'--graph-surface-secondary': '#2d3748',
	'--graph-border': '#30363d',
	'--graph-text-primary': '#f0f6fc',
	'--graph-text-secondary': '#7d8590',
	'--graph-primary': '#3182ce',
	'--graph-node-background': '#0d1117',
	'--graph-node-header': '#161b22',
	'--graph-node-border': '#30363d',
	'--graph-connection-color': '#30363d',
	'--graph-highlight-color': '#f85149',
	'--graph-grid-color': '#30363d',
	'--graph-array-indicator': '#ec4899',
	'--graph-row-alt': 'rgba(22, 27, 34, 0.1)',
	'--color-background': '#0d1117',
	'--color-surface': '#1a202c',
	'--color-surface-secondary': '#2d3748',
	'--color-border': '#30363d',
	'--color-text': '#f0f6fc',
	'--color-text-secondary': '#7d8590',
	'--color-primary': '#3182ce',
	'--color-error': '#f85149',
	'--border-radius-sm': '4px',
	'--border-radius-md': '8px',
	'--spacing-sm': '12px',
	'--spacing-md': '16px',
};

/** Resolve CSS variables in an element and all its children */
function resolveCssVariablesInElement(element: Element): void {
	// Process all attributes
	for (const attr of Array.from(element.attributes)) {
		if (attr.value.includes('var(')) {
			attr.value = replaceCssVars(attr.value);
		}
	}
	
	// Process inline style
	if (element instanceof HTMLElement || element instanceof SVGElement) {
		const style = element.getAttribute('style');
		if (style?.includes('var(')) {
			element.setAttribute('style', replaceCssVars(style));
		}
	}
	
	// Recursively process children
	for (const child of Array.from(element.children)) {
		resolveCssVariablesInElement(child);
	}
}

/** Replace CSS variable references with actual values */
function replaceCssVars(value: string): string {
	return value.replace(/var\(\s*([^,)]+)\s*(?:,\s*([^)]+))?\)/g, (_, varName, fallback) => {
		const trimmedVar = varName.trim();
		return CSS_FALLBACKS[trimmedVar] || fallback?.trim() || '#000000';
	});
}

