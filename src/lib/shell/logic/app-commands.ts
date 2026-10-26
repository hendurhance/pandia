import type { Command } from '$lib/palette/state/command-store.svelte';
import type { OpenSource } from '$lib/ipc/bindings';
import { SETTINGS_TABS, type SettingsTab } from '$lib/settings/tabs';
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
	openInTab: (source: OpenSource) => void;
	toggleSidebar: () => void;
	revealSchemaPanel: () => void;
	toggleComparePicker: () => void;
	openSettings: (tab?: SettingsTab) => void;
	openHelp: () => void;
	openWhatsNew: () => void;
	openFeedback: () => void;
	togglePalette: () => void;
	clearRecents: () => void;
	showAbout: () => Promise<void> | void;
	checkForUpdates: () => Promise<void> | void;
	openWebsite: () => void;
	openDiscussions: () => void;
	reportIssue: () => void;

	isDev: boolean;
}

export function buildShellCommands(deps: ShellCommandDeps): Command[] {
	return [
		{ id: 'tab.new', label: 'New Tab', category: 'Tab', run: deps.newTab },
		{
			id: 'tab.close',
			label: 'Close Tab',
			category: 'Tab',
			run: () => deps.requestCloseTab(deps.activeTabId()),
		},
		{
			id: 'tab.next',
			label: 'Next Tab',
			category: 'Tab',
			enabled: () => deps.tabsLength() > 1,
			run: deps.nextTab,
		},
		{
			id: 'tab.prev',
			label: 'Previous Tab',
			category: 'Tab',
			enabled: () => deps.tabsLength() > 1,
			run: deps.prevTab,
		},
		{ id: 'doc.new', label: 'New File', category: 'Document', run: deps.newTab },
		{
			id: 'doc.openFile',
			label: 'Open File…',
			category: 'Document',
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
			id: 'doc.clearRecents',
			label: 'Clear Recent Files',
			category: 'Document',
			run: deps.clearRecents,
		},
		{
			id: 'palette.toggle',
			label: 'Command Palette',
			category: 'View',
			hidden: true,
			run: deps.togglePalette,
		},
		{
			id: 'view.toggleSidebar',
			label: 'Toggle Sidebar',
			category: 'View',
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
			enabled: () => deps.hasActiveContext(),
			run: deps.toggleComparePicker,
		},
		{
			id: 'nav.settings',
			label: 'Open Settings',
			category: 'Navigate',
			run: () => deps.openSettings(),
		},

		...SETTINGS_TABS.slice(1).map(
			(tab): Command => ({
				id: `nav.settings.${tab.id}`,
				label: `Open Settings: ${tab.label}`,
				category: 'Navigate',
				run: () => deps.openSettings(tab.id),
			}),
		),
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
			id: 'help.whatsNew',
			label: "What's New",
			category: 'Help',
			run: deps.openWhatsNew,
		},
		{
			id: 'help.shortcuts',
			label: 'Keyboard Shortcuts',
			category: 'Help',
			run: deps.openHelp,
		},
		{
			id: 'help.website',
			label: 'View Website',
			category: 'Help',
			run: deps.openWebsite,
		},
		{
			id: 'help.discussions',
			label: 'Join Discussions…',
			category: 'Help',
			run: deps.openDiscussions,
		},
		{
			id: 'help.reportIssue',
			label: 'Report Issue…',
			category: 'Help',
			run: deps.reportIssue,
		},
		{
			id: 'help.feedback',
			label: 'Send Feedback…',
			category: 'Help',
			run: deps.openFeedback,
		},
		{
			id: 'app.about',
			label: 'About Pandia',
			category: 'Help',
			run: () => void deps.showAbout(),
		},
		{
			id: 'app.checkForUpdates',
			label: 'Check for Updates…',
			category: 'Help',
			run: () => void deps.checkForUpdates(),
		},
	];
}
