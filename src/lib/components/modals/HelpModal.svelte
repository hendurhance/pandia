<script lang="ts">
	import { shortcutManager, showShortcutsModal } from "$lib/stores/shortcuts";
	import Icon from "../ui/Icon.svelte";
	import BaseModal from "./BaseModal.svelte";

	interface Props {
		show?: boolean;
		mode?: "shortcuts" | "viewmodes";
		onclose?: () => void;
	}

	let {
		show = $bindable(false),
		mode = "shortcuts",
		onclose,
	}: Props = $props();

	const shortcuts = $derived(shortcutManager.getShortcuts());

	const groupedShortcuts = $derived(() => {
		const groups: Record<string, typeof shortcuts> = {
			"File Operations": [],
			Edit: [],
			View: [],
			Tools: [],
		};

		shortcuts.forEach((shortcut) => {
			const action = shortcut.action.toLowerCase();
			if (["new", "open", "save"].some((a) => action.includes(a))) {
				groups["File Operations"].push(shortcut);
			} else if (
				["undo", "redo", "find", "replace", "format"].some((a) =>
					action.includes(a),
				)
			) {
				groups["Edit"].push(shortcut);
			} else if (
				["mode", "view", "zoom"].some((a) => action.includes(a))
			) {
				groups["View"].push(shortcut);
			} else {
				groups["Tools"].push(shortcut);
			}
		});

		return Object.entries(groups).filter(([_, items]) => items.length > 0);
	});

	const viewModes = [
		{
			id: "tree",
			name: "Tree View",
			icon: "tree-view",
			description: "Browsing and editing structured JSON data",
			features: [
				"Interactive tree with expand/collapse",
				"Visual JSON structure representation",
				"Click to edit values inline",
				"Drag and drop to reorder",
				"Built-in validation",
			],
		},
		{
			id: "text",
			name: "Text Editor",
			icon: "text-view",
			description: "Raw JSON text manipulation and development",
			features: [
				"Syntax highlighting",
				"Line numbers and guides",
				"Bracket matching",
				"Find/replace functionality",
				"Best for large files",
			],
		},
		{
			id: "grid",
			name: "Grid View",
			icon: "grid",
			description: "JSON arrays and objects in tabular format",
			features: [
				"Spreadsheet-like interface",
				"Perfect for arrays of objects",
				"Easy data comparison",
				"Quick overview of datasets",
			],
		},
	];

	const headerConfig = $derived(
		mode === "shortcuts"
			? {
					icon: "shortcuts",
					title: "Keyboard Shortcuts",
					subtitle: "Work faster with keyboard commands",
				}
			: {
					icon: "visualize",
					title: "View Modes",
					subtitle: "Choose the right view for your task",
				},
	);

	function close() {
		show = false;
		showShortcutsModal.set(false);
		onclose?.();
	}
</script>

<BaseModal
	bind:visible={show}
	title={headerConfig.title}
	subtitle={headerConfig.subtitle}
	icon={headerConfig.icon}
	width="md"
	onclose={close}
>
	<div class="modal-body">
		{#if mode === "shortcuts"}
			<div class="panel">
				<div class="intro-box">
					<p>
						Use keyboard shortcuts to work faster. These shortcuts
						are active when the editor has focus.
					</p>
				</div>

				{#each groupedShortcuts() as [category, items]}
					<section class="shortcut-section">
						<h3 class="section-title">{category}</h3>
						<div class="shortcuts-list">
							{#each items as shortcut}
								<div class="shortcut-row">
									<span class="shortcut-desc"
										>{shortcut.description}</span
									>
									<kbd class="shortcut-key"
										>{shortcutManager.formatShortcut(
											shortcut,
										)}</kbd
									>
								</div>
							{/each}
						</div>
					</section>
				{/each}

				<div class="tip-box">
					<div class="tip-icon">
						<Icon name="info" size={16} />
					</div>
					<div class="tip-content">
						<strong>Pro Tip:</strong> Press <kbd>Ctrl+K</kbd> anywhere
						to quickly open this shortcuts reference.
					</div>
				</div>
			</div>
		{:else if mode === "viewmodes"}
			<div class="panel">
				<div class="intro-box">
					<p>
						Choose the right view mode for your task. Switch modes
						using the dropdown in the toolbar.
					</p>
				</div>

				<div class="viewmodes-grid">
					{#each viewModes as viewMode}
						<div class="viewmode-card">
							<div class="card-header">
								<div class="mode-icon">
									<Icon name={viewMode.icon} size={24} />
								</div>
								<div class="mode-info">
									<h3>{viewMode.name}</h3>
									<p class="mode-desc">
										{viewMode.description}
									</p>
								</div>
							</div>
							<ul class="feature-list">
								{#each viewMode.features as feature}
									<li>
										<Icon name="check" size={12} />
										<span>{feature}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>

				<div class="tip-box">
					<div class="tip-icon">
						<Icon name="info" size={16} />
					</div>
					<div class="tip-content">
						<strong>Pro Tip:</strong> Tree View is great for exploring,
						Text Editor for precision editing, and Grid View for data
						analysis.
					</div>
				</div>
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<div class="footer-content">
			<button class="btn btn-primary" onclick={close}> Got it </button>
		</div>
	{/snippet}
</BaseModal>

<style>
	.modal-body {
		padding: var(--spacing-lg);
	}

	.panel {
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.intro-box {
		margin-bottom: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--color-surface-secondary);
		border-radius: var(--border-radius-md);
		border: 1px solid var(--color-border);
	}

	.intro-box p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.shortcut-section {
		margin-bottom: var(--spacing-lg);
	}

	.section-title {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.shortcuts-list {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		overflow: hidden;
	}

	.shortcut-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.shortcut-row:last-child {
		border-bottom: none;
	}

	.shortcut-row:hover {
		background: var(--color-surface-hover);
	}

	.shortcut-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.shortcut-key {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-background-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.viewmodes-grid {
		display: grid;
		gap: var(--spacing-md);
	}

	.viewmode-card {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		transition: all 0.15s;
	}

	.viewmode-card:hover {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 1px rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
	}

	.card-header {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.mode-icon {
		width: 48px;
		height: 48px;
		border-radius: var(--border-radius-md);
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.mode-info h3 {
		margin: 0 0 4px 0;
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text);
	}

	.mode-desc {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.feature-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--spacing-xs);
	}

	.feature-list li {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	.feature-list li :global(svg) {
		color: var(--color-success);
		flex-shrink: 0;
	}

	.tip-box {
		display: flex;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.08);
		border: 1px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.2);
		border-radius: var(--border-radius-md);
		margin-top: var(--spacing-lg);
	}

	.tip-icon {
		color: var(--color-primary);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.tip-content {
		font-size: var(--font-size-sm);
		color: var(--color-text);
		line-height: 1.5;
	}

	.tip-content strong {
		color: var(--color-primary);
	}

	.tip-content kbd {
		padding: 2px 6px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 3px;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.footer-content {
		display: flex;
		justify-content: flex-end;
		width: 100%;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-lg);
		border: none;
		border-radius: var(--border-radius-sm);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-primary {
		background: var(--color-primary);
		color: var(--color-text-inverted);
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}

	@media (max-width: 640px) {
		.feature-list {
			grid-template-columns: 1fr;
		}

		.shortcut-row {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--spacing-xs);
		}
	}
</style>
