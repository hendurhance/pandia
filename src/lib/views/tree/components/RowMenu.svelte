<script lang="ts">
	import { pathToString } from '$lib/util/path';
	import Popover from '$lib/ui/Popover.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronRight } from '@lucide/svelte';
	import type { ContentRow, MenuAction } from '../logic/model';
	import { buildMenuModel } from '../logic/row-menu-model';

	interface Props {
		x: number;
		y: number;
		row: ContentRow;
		onAction: (action: MenuAction) => void;
		onClose: () => void;

		canMoveUp?: boolean;
		canMoveDown?: boolean;
	}

	let { x, y, row, onAction, onClose, canMoveUp = false, canMoveDown = false }: Props = $props();

	const targetPath = $derived(pathToString(row.path));

	function trigger(action: MenuAction) {
		onAction(action);
		onClose();
	}

	const groups = $derived(buildMenuModel(row, { canMoveUp, canMoveDown }));

	const MENU_W = 248;
	const SUBMENU_W = 168;
	const MENU_H = 440;
</script>

<Popover {x} {y} width={MENU_W} height={MENU_H} flushAllowance={SUBMENU_W} {onClose}>
	{#snippet children({ flushRight })}
		<div class="menu" class:sub-left={flushRight} role="menu">
			<div class="menu-head">
				<span>at</span><span class="target">{targetPath}</span>
			</div>

			{#each groups as group, gi (gi)}
				{#if gi > 0}<div class="menu-divider"></div>{/if}
				{#each group as item (item.type === 'sub' ? 's:' + item.label : 'a:' + item.action)}
					{#if item.type === 'action'}
						<button
							class="menu-item"
							class:danger={item.danger}
							onclick={() => trigger(item.action)}
							role="menuitem"
						>
							<span class="ico">{item.ico}</span><span class="lbl">{item.label}</span>
						</button>
					{:else}
						<div class="menu-item has-sub" role="menuitem" aria-haspopup="menu" tabindex="0">
							<span class="ico">{item.ico}</span><span class="lbl">{item.label}</span><span
								class="chev"><Icon icon={ChevronRight} size="xs" /></span
							>
							<div class="submenu" role="menu">
								{#each item.children as c (c.action)}
									<button
										class="menu-item sub-item"
										disabled={c.disabled}
										onclick={() => trigger(c.action)}
										role="menuitem"
									>
										<span class="lbl">{c.label}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			{/each}

			<div class="menu-tip">right-click · <span class="kbd">⌃Q</span> · esc to close</div>
		</div>
	{/snippet}
</Popover>

<style>
	.menu {
		min-width: 248px;
	}

	.menu-head .target {
		color: var(--accent-2);
		letter-spacing: 0;
		text-transform: none;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu-item .ico {
		color: var(--text-faint);
		width: 12px;
		font-size: 11px;
		text-align: center;
		flex-shrink: 0;
	}
	.menu-item .lbl {
		flex: 1;
	}
	.menu-item .chev {
		color: var(--text-faint);
		font-size: 10px;
		flex-shrink: 0;
	}
	.has-sub:focus-within {
		background: var(--bg-elev-2);
	}
	.menu-item:hover:not(:disabled) .ico,
	.menu-item:hover:not(:disabled) .chev {
		color: var(--accent);
	}

	.menu-item.danger .ico {
		color: var(--danger);
	}
	.menu-item.danger:hover .ico {
		color: var(--danger);
	}

	.has-sub {
		position: relative;
	}
	.submenu {
		display: none;
		position: absolute;
		left: 100%;
		top: -5px;
		min-width: 168px;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule-2);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
		padding: 4px 0;
		z-index: 1001;
		flex-direction: column;
	}
	.has-sub:hover > .submenu,
	.has-sub:focus-within > .submenu {
		display: flex;
	}

	.sub-left .submenu {
		left: auto;
		right: 100%;
	}
	.sub-item {
		padding-left: 16px;
	}

	.menu-tip .kbd {
		color: var(--text-dim);
		border: var(--rule-width) solid var(--rule-2);
		padding: 0 4px;
		font-size: 9.5px;
	}
</style>
