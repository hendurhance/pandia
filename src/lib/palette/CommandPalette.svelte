<script lang="ts">
	import {
		commandRegistry,
		commandUsage,
		type Command,
		type CommandCategory,
	} from './state/command-store.svelte';
	import { fuzzyMatch, highlightLabel } from './match';
	import { fmtKbd } from '$lib/util/platform';
	import { shortcutKeys } from '$lib/shell/logic/shortcuts';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let query = $state('');
	let selectedIdx = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLUListElement | undefined = $state();
	let pressedBackdrop = false;
	let ranCommand = false;

	$effect(() => {
		if (!open) return;
		query = '';
		selectedIdx = 0;
		ranCommand = false;
		const returnFocus = document.activeElement;
		queueMicrotask(() => inputEl?.focus());
		return () => {
			if (!ranCommand && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
				returnFocus.focus();
			}
		};
	});

	interface Entry {
		cmd: Command;
		score: number;
		ranges: Array<[number, number]>;
		section: CommandCategory | 'Recent';
	}

	const results = $derived.by<Entry[]>(() => {
		const cmds = commandRegistry.list.filter((c) => !c.hidden && (!c.enabled || c.enabled()));
		const trimmed = query.trim();

		if (!trimmed) {
			const recentIds = commandUsage.topN(
				5,
				cmds.map((c) => c.id),
			);
			const recent: Entry[] = recentIds
				.map((id) => cmds.find((c) => c.id === id))
				.filter((c): c is Command => !!c)
				.map((cmd) => ({ cmd, score: 1, ranges: [], section: 'Recent' as const }));
			const recentSet = new Set(recent.map((r) => r.cmd.id));
			const rest: Entry[] = cmds
				.filter((c) => !recentSet.has(c.id))
				.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
				.map((cmd) => ({ cmd, score: 1, ranges: [], section: cmd.category }));
			return [...recent, ...rest];
		}

		return cmds
			.map<Entry>((cmd) => {
				const m = fuzzyMatch(trimmed, cmd.label);
				return { cmd, score: m.score, ranges: m.ranges, section: cmd.category };
			})
			.filter((e) => e.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 50);
	});

	$effect(() => {
		if (selectedIdx > 0 && selectedIdx >= results.length) {
			selectedIdx = Math.max(0, results.length - 1);
		}
	});

	function execute(idx: number) {
		const r = results[idx];
		if (!r) return;
		commandUsage.bump(r.cmd.id);
		ranCommand = true;
		onClose();
		void r.cmd.run();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (results.length > 0) {
				selectedIdx = Math.min(results.length - 1, selectedIdx + 1);
				scrollIntoView(selectedIdx);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (results.length > 0) {
				selectedIdx = Math.max(0, selectedIdx - 1);
				scrollIntoView(selectedIdx);
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			execute(selectedIdx);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	function scrollIntoView(idx: number) {
		const el = listEl?.querySelector(`[data-i="${idx}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	}

	function showSectionFor(i: number): string | null {
		if (query.trim()) return null;
		const cur = results[i];
		if (!cur) return null;
		const prev = i > 0 ? results[i - 1] : null;
		if (prev && prev.section === cur.section) return null;
		return cur.section;
	}
</script>

{#if open}
	<div
		class="backdrop"
		onmousedown={(e) => (pressedBackdrop = e.target === e.currentTarget)}
		onclick={() => pressedBackdrop && onClose()}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="presentation"
	>
		<div
			class="palette"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === 'Tab') {
					e.preventDefault();
					inputEl?.focus();
				}
			}}
			role="dialog"
			aria-label="Command palette"
			tabindex="-1"
		>
			<div class="search">
				<span class="prompt">›</span>
				<input
					bind:this={inputEl}
					bind:value={query}
					onkeydown={onKeyDown}
					placeholder="type a command…"
					spellcheck="false"
					autocomplete="off"
				/>
				<span class="kbd-hint">esc</span>
			</div>

			<ul bind:this={listEl} class="list" role="listbox">
				{#if results.length === 0}
					<li class="empty">No matching commands</li>
				{:else}
					{#each results as r, i (r.cmd.id)}
						{@const section = showSectionFor(i)}
						{@const keys = shortcutKeys(r.cmd.id)}
						{#if section}
							<li class="section">{section === 'Recent' ? 'Recently used' : section}</li>
						{/if}
						<li
							data-i={i}
							class="list-row row"
							class:selected={i === selectedIdx}
							onclick={() => execute(i)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									execute(i);
								}
							}}
							onmouseenter={() => (selectedIdx = i)}
							role="option"
							aria-selected={i === selectedIdx}
							tabindex="-1"
						>
							<span class="label">{@html highlightLabel(r.cmd.label, r.ranges)}</span>

							{#if query.trim() || r.section === 'Recent'}
								<span class="cat">{r.cmd.category}</span>
							{/if}
							{#if keys}
								<span class="kbd">{fmtKbd(keys)}</span>
							{/if}
						</li>
					{/each}
				{/if}
			</ul>

			<footer class="footer">
				<span class="dim text-xs">↑↓ navigate · ↵ run · esc close</span>
				<span class="dim text-xs"
					>{results.length} {results.length === 1 ? 'command' : 'commands'}</span
				>
			</footer>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--scrim);
		display: grid;
		grid-template-rows: 22vh 1fr;
		justify-content: center;
		/* above dialogs (2000), so ⌘K over a dialog is seen */
		z-index: 2100;
	}
	.palette {
		grid-row: 2;
		width: min(580px, 92vw);
		max-height: 60vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		box-shadow: var(--shadow-modal);
		font-family: var(--font-mono);
		color: var(--text);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm);
		border-bottom: var(--rule-width) solid var(--rule);
		background: var(--bg);
	}
	.prompt {
		color: var(--text-dim);
		font-weight: bold;
	}
	.search input {
		flex: 1;
		background: transparent;
		border: none;
		padding: 0;
		outline: none;
	}
	.kbd-hint {
		font-size: var(--font-size-xs);
		color: var(--text-dim);
		padding: 0 0.4ch;
		border: var(--rule-width) solid var(--rule);
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		list-style: none;
		padding: var(--space-xs) 0;
		margin: 0;
	}

	.section {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--bg-elev);
		margin-top: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		color: var(--text-dim);
		border-top: var(--rule-width) solid var(--rule);
	}
	.section:first-child {
		margin-top: 0;
		border-top: none;
	}

	.row {
		align-items: baseline;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		font-size: var(--font-size-base);
		user-select: none;
	}
	.row.selected {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cat {
		flex-shrink: 0;
		color: var(--text-dim);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
	}
	.row.selected .cat {
		color: var(--accent);
	}
	.label :global(mark) {
		background: transparent;
		color: var(--accent-2);
		font-weight: 700;
	}
	.row.selected .label :global(mark) {
		color: var(--accent);
	}
	.kbd {
		flex-shrink: 0;
		font-size: var(--font-size-xs);
		color: var(--text-dim);
		padding: 0 0.5ch;
		border: var(--rule-width) solid var(--rule);
	}
	.row.selected .kbd {
		color: var(--accent);
		border-color: var(--accent);
	}

	.empty {
		padding: var(--space-xl) var(--space-sm);
		text-align: center;
		color: var(--text-dim);
		font-size: var(--font-size-sm);
	}

	.footer {
		display: flex;
		justify-content: space-between;
		gap: var(--space-sm);
		padding: var(--space-xs) var(--space-sm);
		border-top: var(--rule-width) solid var(--rule);
		background: var(--bg);
	}
</style>
