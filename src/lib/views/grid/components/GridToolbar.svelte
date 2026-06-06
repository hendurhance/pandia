<script lang="ts">
	import { chipSummary, type ColFilter } from '../logic/grid-filter-model';
	import Icon from '$lib/ui/Icon.svelte';
	import { ArrowDown, ArrowUp, Search, X } from '@lucide/svelte';

	let {
		quick = $bindable(''),
		groups,
		activeGroup,
		hasFilter,
		filtering,
		fetching = false,
		filteredTotal,
		rowCount,
		colCount,
		sortKey,
		sortDesc,
		onClearColumnIn,
		onClearAll,
		onAddGroup,
		onRemoveGroup,
		onSetActiveGroup,
	}: {
		quick?: string;
		groups: [string, ColFilter][][];
		activeGroup: number;
		hasFilter: boolean;
		filtering: boolean;
		fetching?: boolean;
		filteredTotal: number | null;
		rowCount: number;
		colCount: number;
		sortKey: string | null;
		sortDesc: boolean;
		onClearColumnIn: (groupIdx: number, key: string) => void;
		onClearAll: () => void;
		onAddGroup: () => void;
		onRemoveGroup: (groupIdx: number) => void;
		onSetActiveGroup: (groupIdx: number) => void;
	} = $props();
</script>

<div class="grid-toolbar">
	<label class="quick">
		<span class="quick-ico"><Icon icon={Search} size="xs" /></span>
		<input
			bind:value={quick}
			placeholder="Filter rows…"
			spellcheck="false"
			autocapitalize="off"
			autocorrect="off"
			autocomplete="off"
			aria-label="filter rows"
		/>
		{#if quick}
			<button class="btn-ghost quick-x" onclick={() => (quick = '')} aria-label="clear search"
				><Icon icon={X} size="xs" /></button
			>
		{/if}
	</label>

	<div class="builder-scroll">
		{#if hasFilter}
			<div class="builder" class:multi={groups.length > 1}>
				{#each groups as cols, gi (gi)}
					{#if gi > 0}<span class="or-pill">OR</span>{/if}
					
					<div
						class="grp"
						class:active={gi === activeGroup}
						role="button"
						tabindex="0"
						title={gi === activeGroup
							? 'active group — column filters land here'
							: 'make this group active'}
						onclick={() => onSetActiveGroup(gi)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSetActiveGroup(gi)}
					>
						{#each cols as [key, c] (key)}
							<span class="chip">
								<span class="chip-key">{key}</span>
								<span class="chip-sum">{chipSummary(c)}</span>
								<button
									class="btn-ghost chip-x"
									onclick={(e) => {
										e.stopPropagation();
										onClearColumnIn(gi, key);
									}}
									aria-label="remove filter"><Icon icon={X} size="xs" /></button
								>
							</span>
						{/each}
						{#if cols.length === 0}<span class="grp-hint">pick a column ▾</span>{/if}
						
						{#if groups.length > 1 && cols.length !== 1}
							{#if cols.length >= 2}<span class="grp-sep"></span>{/if}
							<button
								class="btn-ghost grp-x"
								onclick={(e) => {
									e.stopPropagation();
									onRemoveGroup(gi);
								}}
								aria-label="Remove group"
								title="Remove this OR-group"><Icon icon={X} size="xs" /></button
							>
						{/if}
					</div>
				{/each}
				<button class="or-add" onclick={onAddGroup} title="Add an OR group (match either)"
					>+ OR</button
				>
			</div>
		{/if}
	</div>

	<div class="toolbar-right">
		{#if hasFilter}
			<button class="link-btn" onclick={onClearAll}>Clear all</button>
		{/if}
		<span class="counts">
			{#if filtering && fetching && filteredTotal === null}
				<span class="fetching">Filtering…</span>
			{:else if filtering}
				<b>{(filteredTotal ?? 0).toLocaleString()}</b> of {rowCount.toLocaleString()} rows
			{:else}
				{rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
			{/if}
			· {colCount} cols
		</span>
		{#if sortKey}
			<span class="sort-status"
				>· <b>{sortKey}</b> <Icon icon={sortDesc ? ArrowDown : ArrowUp} size="xs" /></span
			>
		{/if}
	</div>
</div>

<style>
	.grid-toolbar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.25rem 0.75rem;
		border-bottom: 1px solid var(--rule);
		background: var(--bg-elev);
		font-size: 11.5px;
		color: var(--text-dim);
	}
	.grid-toolbar .counts {
		font-variant-numeric: tabular-nums;
		flex: 0 0 auto;
		color: var(--text-faint);
		white-space: nowrap;
	}
	.grid-toolbar .counts b {
		color: var(--text);
		font-weight: 600;
	}
	.grid-toolbar .fetching {
		color: var(--accent);
		font-style: italic;
	}
	.sort-status {
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.sort-status b {
		color: var(--accent);
		font-weight: 400;
	}

	.quick {
		display: inline-flex;
		align-items: center;
		gap: 0.5ch;
		flex: 0 1 240px;
		min-width: 140px;
		padding: 0.1rem 0.5ch;
		background: var(--bg);
		border: 1px solid var(--rule-2);
		border-radius: 3px;
	}
	.quick:focus-within {
		border-color: var(--accent);
	}
	.quick-ico {
		display: inline-flex;
		align-items: center;
		color: var(--text-faint);
		flex: 0 0 auto;
	}
	.quick input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 11.5px;
		padding: 0.1rem 0;
	}
	.quick input:focus {
		outline: none;
	}
	.quick-x {
		color: var(--text-faint);
		font-size: 13px;
		padding: 0 0.2ch;
	}

	
	
	.builder-scroll {
		flex: 1 1 auto;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.builder-scroll::-webkit-scrollbar {
		height: 6px;
	}
	.builder-scroll::-webkit-scrollbar-thumb {
		background: var(--rule-2);
		border-radius: 3px;
	}
	.builder-scroll::-webkit-scrollbar-track {
		background: transparent;
	}
	.builder {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 0.4rem;
		width: max-content;
	}
	.toolbar-right {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.grp {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.builder.multi .grp {
		padding: 0.1rem 0.3rem 0.1rem 0.45rem;
		border: 1px dashed var(--rule-2);
		border-radius: 4px;
		cursor: pointer;
	}
	.builder.multi .grp.active {
		border-style: solid;
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.or-pill {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		background: var(--bg-elev-3);
		border: 1px solid var(--rule-2);
		border-radius: 3px;
		padding: 0.05rem 0.35rem;
	}
	.grp-hint {
		color: var(--text-faint);
		font-style: italic;
	}
	.grp-sep {
		align-self: stretch;
		width: 1px;
		margin: 0.1rem 0.05rem;
		background: var(--rule-2);
	}
	.grp-x {
		color: var(--text-faint);
		font-size: 13px;
		line-height: 1;
		padding: 0 0.2ch;
		align-self: center;
	}
	.grp-x:hover {
		color: var(--accent);
	}
	.or-add {
		background: none;
		border: 1px dashed var(--rule-2);
		border-radius: 4px;
		color: var(--text-dim);
		cursor: pointer;
		font-size: 11px;
		font-family: inherit;
		padding: 0.05rem 0.4rem;
	}
	.or-add:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5ch;
		padding: 0.1rem 0.2ch 0.1rem 0.6ch;
		background: var(--accent-soft);
		border-radius: 3px;
		white-space: nowrap;
		max-width: 260px;
	}
	.chip-key {
		color: var(--text);
		font-weight: 600;
	}
	.chip-sum {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-x {
		color: var(--text-faint);
		padding: 0 0.3ch;
		font-size: 12px;
		align-self: center;
	}

	.link-btn {
		background: none;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: 11px;
		padding: 0;
		white-space: nowrap;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.link-btn:hover {
		color: var(--accent);
	}
</style>
