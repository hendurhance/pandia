<script lang="ts">
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { X } from '@lucide/svelte';
	import { commandRegistry, type CommandCategory } from '$lib/palette/state/command-store.svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	interface Shortcut {
		keys: string[];
		label: string;
	}
	interface Group {
		title: string;
		items: Shortcut[];
	}

	const MODIFIERS = new Set(['⌘', '⇧', '⌃', '⌥']);
	function splitKeys(binding: string): string[] {
		const keys: string[] = [];
		let i = 0;
		while (i < binding.length && MODIFIERS.has(binding[i])) keys.push(binding[i++]);
		if (i < binding.length) keys.push(binding.slice(i));
		return keys;
	}

	const CATEGORY_TITLES: Partial<Record<CommandCategory, string>> = {
		Tab: 'Tabs',
		Document: 'Document',
		'Import / Export': 'Import / Export',
		View: 'View',
		Navigate: 'Navigate',
		Compare: 'Compare',
		Help: 'Help',
	};
	const CATEGORY_ORDER: CommandCategory[] = [
		'Tab',
		'Document',
		'Import / Export',
		'View',
		'Navigate',
		'Compare',
		'Help',
	];

	const commandGroups = $derived.by<Group[]>(() => {
		const byCategory = new Map<CommandCategory, Shortcut[]>();
		for (const c of commandRegistry.list) {
			if (!c.keybinding) continue;
			const items = byCategory.get(c.category) ?? [];
			items.push({ keys: splitKeys(c.keybinding), label: c.label });
			byCategory.set(c.category, items);
		}
		return CATEGORY_ORDER.flatMap((cat) => {
			const items = byCategory.get(cat);
			return items?.length ? [{ title: CATEGORY_TITLES[cat] ?? cat, items }] : [];
		});
	});

	const GENERAL: Group = {
		title: 'General',
		items: [{ keys: ['⌘', 'K'], label: 'Command palette' }],
	};
	const IN_THE_TREE: Group = {
		title: 'In the tree',
		items: [
			{ keys: ['⌃', 'Q'], label: 'Row menu (or right-click)' },
			{ keys: ['⏎'], label: 'Commit an edit' },
			{ keys: ['Esc'], label: 'Cancel an edit' },
			{ keys: ['⌘', '⏎'], label: 'Commit a multi-line string' },
		],
	};

	const groups = $derived([GENERAL, ...commandGroups, IN_THE_TREE]);
</script>

<Dialog {onClose}>
	<div class="dialog sheet" role="dialog" aria-label="keyboard shortcuts">
		<div class="dialog-head">
			<span class="dialog-title">keyboard shortcuts</span>
			<span class="grow"></span>
			<button class="btn-close" onclick={onClose} aria-label="close" title="close (esc)"
				><Icon icon={X} size="sm" /></button
			>
		</div>

		<div class="body">
			{#each groups as g (g.title)}
				<section class="grp">
					<div class="grp-title">{g.title}</div>
					<ul class="rows">
						{#each g.items as it (it.label)}
							<li class="row">
								<span class="keys">
									{#each it.keys as k (k)}<kbd>{k}</kbd>{/each}
								</span>
								<span class="lbl">{it.label}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>

		<footer class="foot">
			<span class="dim text-xs">on Windows / Linux, ⌘ is Ctrl</span>
		</footer>
	</div>
</Dialog>

<style>
	.sheet {
		width: min(720px, 92%);
		max-height: 82%;
		font-family: var(--font-mono);
	}

	.body {
		overflow-y: auto;
		padding: 0.9rem 1rem 0.4rem;
		
		columns: 2;
		column-gap: 2rem;
	}
	.grp {
		break-inside: avoid;
		margin-bottom: 1rem;
	}
	.grp-title {
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-size: var(--font-size-xs);
		padding-bottom: 0.35rem;
		margin-bottom: 0.25rem;
		border-bottom: var(--rule-width) solid var(--rule);
	}
	
	.rows {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.8rem;
		row-gap: 0.34rem;
		align-items: baseline;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: contents;
	}
	.keys {
		display: flex;
		gap: 3px;
		justify-content: flex-start;
	}
	.keys kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		min-width: 1.4em;
		text-align: center;
		padding: 0 0.4ch;
		color: var(--text-dim);
		background: var(--bg);
		border: var(--rule-width) solid var(--rule-2);
		border-radius: 2px;
	}
	.lbl {
		color: var(--text);
		font-size: var(--font-size-sm);
		min-width: 0;
	}

	.foot {
		flex-shrink: 0;
		padding: 0.45rem 0.75rem;
		border-top: var(--rule-width) solid var(--rule);
	}
</style>
