<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	import Self from './NestedGridCell.svelte';

	interface Props {
		value: unknown;
		depth?: number;
		maxDepth?: number;
		expandedPaths?: Set<string>;
		path?: string;
		onToggle?: (path: string) => void;
	}

	let {
		value,
		depth = 0,
		maxDepth = 10,
		expandedPaths = new Set(),
		path = '',
		onToggle
	}: Props = $props();

	function isExpandable(val: unknown): boolean {
		return val !== null && typeof val === 'object';
	}

	function isArray(val: unknown): boolean {
		return Array.isArray(val);
	}

	function getTypeLabel(val: unknown): string {
		if (val === null) return 'null';
		if (Array.isArray(val)) return `Array(${val.length})`;
		if (typeof val === 'object') return `Object(${Object.keys(val as object).length})`;
		return typeof val;
	}

	function getPreview(val: unknown): string {
		if (val === null) return 'null';
		if (Array.isArray(val)) {
			if (val.length === 0) return '[]';
			const preview = val.slice(0, 3).map(v => {
				if (v === null) return 'null';
				if (typeof v === 'object') return Array.isArray(v) ? '[...]' : '{...}';
				if (typeof v === 'string') return `"${v.slice(0, 10)}${v.length > 10 ? '...' : ''}"`;
				return String(v);
			}).join(', ');
			return `[${preview}${val.length > 3 ? ', ...' : ''}]`;
		}
		if (typeof val === 'object') {
			const keys = Object.keys(val as object);
			if (keys.length === 0) return '{}';
			const preview = keys.slice(0, 2).map(k => `${k}: ...`).join(', ');
			return `{${preview}${keys.length > 2 ? ', ...' : ''}}`;
		}
		return String(val);
	}

	function handleToggle() {
		onToggle?.(path);
	}

	$effect(() => {
		expandedPaths;
	});
</script>

{#if !isExpandable(value)}
	<!-- Primitive value -->
	<span class="primitive-value" class:value-null={value === null} class:value-boolean={typeof value === 'boolean'} class:value-number={typeof value === 'number'} class:value-string={typeof value === 'string'}>
		{#if value === null}
			<span class="null">null</span>
		{:else if typeof value === 'boolean'}
			<span class="boolean">{String(value)}</span>
		{:else if typeof value === 'number'}
			<span class="number">{value}</span>
		{:else}
			<span class="string">{String(value)}</span>
		{/if}
	</span>
{:else if depth >= maxDepth}
	<!-- Max depth reached -->
	<span class="max-depth-reached" title="Maximum depth reached">
		{getPreview(value)}
	</span>
{:else}
	<!-- Expandable value -->
	<div class="expandable-cell">
		<button
			class="expand-toggle"
			onclick={handleToggle}
			aria-expanded={expandedPaths.has(path)}
			aria-label={expandedPaths.has(path) ? 'Collapse' : 'Expand'}
		>
			<Icon name={expandedPaths.has(path) ? 'chevron-down' : 'chevron-right'} size={12} />
		</button>

		{#if !expandedPaths.has(path)}
			<!-- Collapsed view -->
			<span class="collapsed-preview" onclick={handleToggle} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && handleToggle()}>
				<span class="type-badge" class:array-badge={isArray(value)} class:object-badge={!isArray(value)}>
					{getTypeLabel(value)}
				</span>
				<span class="preview-text">{getPreview(value)}</span>
			</span>
		{:else}
			<!-- Expanded view -->
			<div class="expanded-content">
				<span class="type-badge expanded" class:array-badge={isArray(value)} class:object-badge={!isArray(value)} onclick={handleToggle} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && handleToggle()}>
					{getTypeLabel(value)}
				</span>

				{#if isArray(value)}
					{@const arrayValue = value as unknown[]}
					<!-- Array items -->
					<div class="nested-array">
						{#each arrayValue as item, idx}
							<div class="nested-item">
								<span class="item-index">[{idx}]</span>
								<div class="item-value">
									<Self
										value={item}
										depth={depth + 1}
										{maxDepth}
										{expandedPaths}
										path={`${path}[${idx}]`}
										{onToggle}
									/>
								</div>
							</div>
						{/each}
						{#if arrayValue.length === 0}
							<span class="empty-indicator">Empty array</span>
						{/if}
					</div>
				{:else}
					{@const objectValue = value as Record<string, unknown>}
					<!-- Object properties -->
					<div class="nested-object">
						{#each Object.entries(objectValue) as [key, val]}
							<div class="nested-item">
								<span class="item-key">{key}:</span>
								<div class="item-value">
									<Self
										value={val}
										depth={depth + 1}
										{maxDepth}
										{expandedPaths}
										path={`${path}.${key}`}
										{onToggle}
									/>
								</div>
							</div>
						{/each}
						{#if Object.keys(objectValue).length === 0}
							<span class="empty-indicator">Empty object</span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.primitive-value {
		display: inline;
	}

	.null {
		color: var(--color-syntax-null, #808080);
		font-style: italic;
	}

	.boolean {
		color: var(--color-syntax-boolean, #569cd6);
		font-weight: 500;
	}

	.number {
		color: var(--color-syntax-number, #b5cea8);
		font-variant-numeric: tabular-nums;
	}

	.string {
		color: var(--color-text-secondary);
	}

	.max-depth-reached {
		color: var(--color-text-muted);
		font-style: italic;
		font-size: 12px;
	}

	.expandable-cell {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		width: 100%;
	}

	.expand-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: 3px;
		flex-shrink: 0;
		transition: all 0.15s ease;
	}

	.expand-toggle:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.collapsed-preview {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		flex: 1;
		min-width: 0;
	}

	.collapsed-preview:hover .preview-text {
		color: var(--color-text);
	}

	.type-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.3px;
		flex-shrink: 0;
		cursor: pointer;
	}

	.type-badge.array-badge {
		background: rgba(206, 147, 216, 0.15);
		color: #ce93d8;
		border: 1px solid rgba(206, 147, 216, 0.3);
	}

	.type-badge.object-badge {
		background: rgba(100, 181, 246, 0.15);
		color: #64b5f6;
		border: 1px solid rgba(100, 181, 246, 0.3);
	}

	.type-badge.expanded {
		margin-bottom: 6px;
	}

	.preview-text {
		font-size: 12px;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		transition: color 0.15s ease;
	}

	.expanded-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.nested-array,
	.nested-object {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-left: 8px;
		border-left: 2px solid var(--color-border-secondary);
		margin-left: 2px;
	}

	.nested-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 3px 0;
	}

	.item-index {
		font-size: 11px;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		min-width: 28px;
		flex-shrink: 0;
	}

	.item-key {
		font-size: 12px;
		color: var(--color-syntax-key, #9cdcfe);
		font-weight: 500;
		flex-shrink: 0;
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-value {
		flex: 1;
		min-width: 0;
	}

	.empty-indicator {
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 2px 0;
	}
</style>
