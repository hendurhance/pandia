<script lang="ts">
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { X } from '@lucide/svelte';
	import { commandRegistry, type CommandCategory } from '$lib/palette/state/command-store.svelte';
	import { fmtKbd } from '$lib/util/platform';
	import { shortcutKeys } from '$lib/shell/logic/shortcuts';

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
		while (i < binding.length) {
			const ch = binding[i];
			if (!ch || !MODIFIERS.has(ch)) break;
			keys.push(ch);
			i++;
		}
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
			const keys = shortcutKeys(c.id);
			if (!keys) continue;
			const items = byCategory.get(c.category) ?? [];
			items.push({ keys: splitKeys(keys), label: c.label });
			byCategory.set(c.category, items);
		}
		return CATEGORY_ORDER.flatMap((cat) => {
			const items = byCategory.get(cat);
			return items?.length ? [{ title: CATEGORY_TITLES[cat] ?? cat, items }] : [];
		});
	});

	const IN_THE_TREE: Group = {
		title: 'In the tree',
		items: [
			{ keys: ['⌃', 'Q'], label: 'Row menu (or right-click)' },
			{ keys: ['⏎'], label: 'Commit an edit' },
			{ keys: ['Esc'], label: 'Cancel an edit' },
			{ keys: ['⌘', '⏎'], label: 'Commit a multi-line string' },
		],
	};

	const groups = $derived([...commandGroups, IN_THE_TREE]);
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
									{#each it.keys as k (k)}<kbd>{k.length === 1 ? fmtKbd(k) : k}</kbd>{/each}
								</span>
								<span class="lbl">{it.label}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
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
		padding: var(--space-md) var(--space-md) var(--space-xs);

		columns: 2;
		column-gap: var(--space-xl);
	}
	.grp {
		break-inside: avoid;
		margin-bottom: var(--space-md);
	}
	.grp-title {
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		padding-bottom: var(--space-xs);
		margin-bottom: var(--space-xs);
		border-bottom: var(--rule-width) solid var(--rule);
	}

	.rows {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: var(--space-md);
		row-gap: var(--space-xs);
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
		gap: var(--space-xs);
		justify-content: flex-start;
	}
	.keys kbd {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
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
</style>
