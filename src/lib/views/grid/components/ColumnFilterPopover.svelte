<script lang="ts">
	import Popover from '$lib/ui/Popover.svelte';
	import type { NodeKind } from '$lib/ipc/types';
	import type { ColumnValues } from '$lib/ipc/doc';
	import { OP_LABEL, valLabel, type ColOp, type ColFilter } from '../logic/grid-filter-model';

	type ListMode = 'loading' | 'checklist' | 'text' | 'none';

	interface FilterView {
		key: string;
		kind: NodeKind;
		op: ColOp;
		opChoices: ColOp[];
		listMode: ListMode;

		distinctValues: ColumnValues['values'] | null;

		capped: boolean;

		current: ColFilter | undefined;

		searchable: boolean;
	}

	interface FilterActions {
		close: () => void;
		clear: () => void;
		updateCol: (patch: Partial<ColFilter>) => void;
		setOp: (op: ColOp) => void;
		setText: (text: string) => void;
		toggleValue: (value: unknown) => void;
		setPresence: (p: 'empty' | 'notEmpty') => void;
		isChecked: (value: unknown) => boolean;
	}

	let {
		view,
		actions,
		anchor,
		anchorEl,
		valueSearch = $bindable(''),
	}: {
		view: FilterView;
		actions: FilterActions;
		anchor: { left: number; top: number };

		anchorEl: HTMLElement | null;
		valueSearch?: string;
	} = $props();
</script>

<Popover x={anchor.left} y={anchor.top} width={264} {anchorEl} onClose={actions.close}>
	<div class="col-filter menu">
		<div class="cf-head">
			<span class="label">{view.key}</span>
			{#if view.current}
				<button class="link-btn" onclick={actions.clear}>clear</button>
			{/if}
		</div>

		{#if view.kind === 'number'}
			<div class="cf-range">
				<input
					type="number"
					placeholder="min"
					value={view.current?.min ?? ''}
					oninput={(e) => actions.updateCol({ min: (e.target as HTMLInputElement).value })}
					aria-label="minimum"
				/>
				<span class="cf-dash">to</span>
				<input
					type="number"
					placeholder="max"
					value={view.current?.max ?? ''}
					oninput={(e) => actions.updateCol({ max: (e.target as HTMLInputElement).value })}
					aria-label="maximum"
				/>
			</div>
		{:else if view.opChoices.length > 0}
			<select
				class="cf-op"
				value={view.op}
				onchange={(e) => actions.setOp((e.target as HTMLSelectElement).value as ColOp)}
				aria-label="operator"
			>
				{#each view.opChoices as op (op)}
					<option value={op}>{OP_LABEL[op]}</option>
				{/each}
			</select>
		{/if}

		{#if view.listMode === 'loading'}
			<div class="cf-state">Loading values…</div>
		{:else if view.listMode === 'text'}
			<input
				class="cf-contains"
				placeholder={view.op === 'startsWith'
					? 'starts with…'
					: view.op === 'is' || view.op === 'isNot'
						? 'exact value…'
						: 'text…'}
				value={view.current?.text ?? ''}
				oninput={(e) => actions.setText((e.target as HTMLInputElement).value)}
				aria-label="value"
			/>
			{#if view.capped}<div class="cf-hint">many distinct values — match by text</div>{/if}
		{:else if view.listMode === 'checklist' && view.distinctValues}
			{#if view.searchable}
				<input
					class="cf-search"
					placeholder="search values…"
					bind:value={valueSearch}
					spellcheck="false"
					aria-label="search values"
				/>
			{/if}
			<div class="cf-list">
				{#each view.distinctValues as cv (JSON.stringify(cv.value))}
					<label class="cf-item">
						<input
							type="checkbox"
							checked={actions.isChecked(cv.value)}
							onchange={() => actions.toggleValue(cv.value)}
						/>
						<span class="cf-val" class:empty={valLabel(cv.value) === '(empty)'}
							>{valLabel(cv.value)}</span
						>
						<span class="cf-count">{cv.count.toLocaleString()}</span>
					</label>
				{:else}
					<div class="cf-state">No matching values</div>
				{/each}
			</div>
		{/if}

		<div class="cf-presence">
			<button
				class="cf-toggle"
				class:on={view.current?.presence === 'empty'}
				onclick={() => actions.setPresence('empty')}>is empty</button
			>
			<button
				class="cf-toggle"
				class:on={view.current?.presence === 'notEmpty'}
				onclick={() => actions.setPresence('notEmpty')}>is not empty</button
			>
		</div>
	</div>
</Popover>

<style>
	.link-btn {
		background: none;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: 11px;
		padding: 0;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.link-btn:hover {
		color: var(--accent);
	}
	.col-filter {
		width: 264px;
		max-width: calc(100vw - 16px);
		gap: 0.5rem;

		padding: 0.6rem;
		font-size: 12px;
	}
	.cf-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.cf-range {
		display: flex;
		align-items: center;
		gap: 0.5ch;
	}
	.cf-range input {
		flex: 1;
		min-width: 0;
	}
	.cf-dash {
		color: var(--text-dim);
	}
	.cf-op {
		width: 100%;
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--rule);
		border-radius: 2px;
		padding: 0.2rem 0.4rem;
		cursor: pointer;
	}
	.cf-op:focus {
		outline: none;
		border-color: var(--accent);
	}
	.cf-presence {
		display: flex;
		gap: 0.4rem;
		padding-top: 0.15rem;
		border-top: 1px solid var(--rule);
	}
	.cf-toggle {
		flex: 1;
		background: var(--bg);
		border: 1px solid var(--rule);
		border-radius: 2px;
		color: var(--text-dim);
		font-size: 11px;
		padding: 0.2rem 0;
		cursor: pointer;
	}
	.cf-toggle:hover {
		color: var(--text);
		border-color: var(--rule-2);
	}
	.cf-toggle.on {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.col-filter input {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--rule);
		border-radius: 2px;
		padding: 0.2rem 0.4rem;
	}
	.col-filter input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.cf-search,
	.cf-contains {
		width: 100%;
	}
	.cf-hint {
		color: var(--text-faint);
		font-size: 10.5px;
	}
	.cf-state {
		color: var(--text-faint);
		padding: 0.4rem 0.2rem;
	}
	.cf-list {
		display: flex;
		flex-direction: column;
		max-height: 240px;
		overflow-y: auto;
		margin: 0 -0.2rem;
	}
	.cf-item {
		display: flex;
		align-items: center;
		gap: 0.7ch;
		min-height: 26px;
		padding: 0.25rem 0.4rem;
		cursor: pointer;
		border-radius: 2px;
	}
	.cf-item:hover {
		background: var(--bg-elev-2);
	}
	.cf-item input {
		flex: 0 0 auto;
		width: 14px;
		height: 14px;
		padding: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.cf-val {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: 12.5px;
	}
	.cf-val.empty {
		color: var(--text-dim);
		font-style: italic;
	}
	.cf-count {
		flex: 0 0 auto;
		color: var(--text-dim);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
</style>
