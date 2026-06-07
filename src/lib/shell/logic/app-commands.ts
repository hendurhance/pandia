import type { Command } from '$lib/palette/state/command-store.svelte';
import type { OpenSource } from '$lib/ipc/types';
import { buildDemoSource } from './demo';

export interface ShellCommandDeps {
	tabsLength: () => number;
	activeTabId: () => string;
	hasActiveContext: () => boolean;
	newTab: () => void;
	requestCloseTab: (id: string) => void;
	nextTab: () => void;
	prevTab: () => void;
	openFile: () => Promise<void> | void;
	openInTab: (source: OpenSource) => boolean;
	toggleSidebar: () => void;
	revealSchemaPanel: () => void;
	toggleComparePicker: () => void;
	openSettings: () => void;
	openHelp: () => void;
	togglePalette: () => void;
	clearRecents: () => void;
	showAbout: () => Promise<void> | void;
	checkForUpdates: () => Promise<void> | void;
	openWebsite: () => void;
	reportIssue: () => void;

	isDev: boolean;
}

export function buildShellCommands(deps: ShellCommandDeps): Command[] {
	return [
		{ id: 'tab.new', label: 'New Tab', category: 'Tab', keybinding: '⌘T', run: deps.newTab },
		{
			id: 'tab.close',
			label: 'Close Tab',
			category: 'Tab',
			keybinding: '⌘W',
			run: () => deps.requestCloseTab(deps.activeTabId()),
		},
		{
			id: 'tab.next',
			label: 'Next Tab',
			category: 'Tab',
			keybinding: '⌘⇧]',
			enabled: () => deps.tabsLength() > 1,
			run: deps.nextTab,
		},
		{
			id: 'tab.prev',
			label: 'Previous Tab',
			category: 'Tab',
			keybinding: '⌘⇧[',
			enabled: () => deps.tabsLength() > 1,
			run: deps.prevTab,
		},
		{
			id: 'doc.openFile',
			label: 'Open File…',
			category: 'Document',
			keybinding: '⌘O',
			run: () => void deps.openFile(),
		},
		{
			id: 'doc.loadDemo',
			label: 'Load Demo',
			category: 'Document',
			run: () => {
				deps.openInTab(buildDemoSource());
			},
		},
		{
			id: 'view.toggleSidebar',
			label: 'Toggle Sidebar',
			category: 'View',
			keybinding: '⌘B',
			run: deps.toggleSidebar,
		},
		{
			id: 'view.openSchemaPanel',
			label: 'Open Schema Panel',
			category: 'View',
			run: deps.revealSchemaPanel,
		},
		{
			id: 'compare.pick',
			label: 'Diff Against Tab or File…',
			category: 'Compare',
			keybinding: '⌘D',
			enabled: () => deps.hasActiveContext(),
			run: deps.toggleComparePicker,
		},
		{
			id: 'nav.settings',
			label: 'Open Settings',
			category: 'Navigate',
			keybinding: '⌘,',
			run: deps.openSettings,
		},
		...(deps.isDev
			? ([
					{
						id: 'nav.sandbox',
						label: 'Open IPC Sandbox',
						category: 'Navigate',
						run: () => {
							window.location.href = '/sandbox';
						},
					},
				] as Command[])
			: []),
		{
			id: 'help.shortcuts',
			label: 'Keyboard Shortcuts',
			category: 'Help',
			keybinding: '⌘/',
			run: deps.openHelp,
		},
		{
			id: 'help.website',
			label: 'View Website',
			category: 'Help',
			run: deps.openWebsite,
		},
		{
			id: 'help.reportIssue',
			label: 'Report Issue…',
			category: 'Help',
			run: deps.reportIssue,
		},
	];
}

export function buildMenuRouteMap(deps: ShellCommandDeps): Record<string, () => void> {
	return {
		new_tab: deps.newTab,
		new_file: deps.newTab,
		close_tab: () => deps.requestCloseTab(deps.activeTabId()),
		next_tab: deps.nextTab,
		prev_tab: deps.prevTab,
		command_palette: deps.togglePalette,
		toggle_sidebar: deps.toggleSidebar,
		compare_files: deps.toggleComparePicker,
		open_file: () => void deps.openFile(),
		validate_json: deps.revealSchemaPanel,
		clear_recent_files: deps.clearRecents,
		keyboard_shortcuts: deps.openHelp,
		view_website: deps.openWebsite,
		report_issue: deps.reportIssue,
		open_settings: deps.openSettings,
		about: () => void deps.showAbout(),
		check_for_updates: () => void deps.checkForUpdates(),
	};
}
