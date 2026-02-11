<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '../ui/Icon.svelte';
	import Select from '../ui/Select.svelte';
	import BaseModal from './BaseModal.svelte';
	import {
		themePreference,
		allThemes,
		createCustomTheme,
		deleteCustomTheme,
		initTheme
	} from '$lib/stores/theme';
	import { preferencesService } from '$lib/stores/preferences';
	import { autoSaveManager, type AutoSaveSettings } from '$lib/stores/autosave';

	interface Props {
		show?: boolean;
		onclose?: () => void;
	}

	let { show = $bindable(false), onclose }: Props = $props();
	let activeTab = $state('general');
	let customThemeName = $state('');
	let customThemeDisplayName = $state('');
	let isCreatingTheme = $state(false);
	let selectedBaseTheme = $state('dark-default');

	// Auto-save settings
	let autoSaveSettings = $state<AutoSaveSettings>(autoSaveManager.getSettings());

	// Custom theme color inputs
	let customColors = $state({
		background: '#0f0f0f',
		primary: '#007acc',
		text: '#ffffff',
		border: '#333333',
		success: '#28a745',
		warning: '#ffc107',
		error: '#dc3545',
	});

	// Ensure theme system and preferences store are initialized on mount
	onMount(() => {
		initTheme();
		preferencesService.init();
		autoSaveSettings = autoSaveManager.getSettings();
	});

	// Access preferences store for reading
	const preferences = preferencesService.getStore();

	const tabs = [
		{ id: 'general', label: 'General', icon: 'settings' },
		{ id: 'editor', label: 'Editor', icon: 'code-view' },
		{ id: 'appearance', label: 'Appearance', icon: 'theme-auto' },
	];

	function close() {
		onclose?.();
	}

	async function handleAutoSaveToggle(enabled: boolean) {
		autoSaveSettings = { ...autoSaveSettings, enabled };
		await autoSaveManager.updateSettings(autoSaveSettings);
	}

	async function handleAutoSaveIntervalChange(interval: number) {
		autoSaveSettings = { ...autoSaveSettings, interval };
		await autoSaveManager.updateSettings(autoSaveSettings);
	}

	async function handleSaveOnIdleToggle(saveOnIdle: boolean) {
		autoSaveSettings = { ...autoSaveSettings, saveOnIdle };
		await autoSaveManager.updateSettings(autoSaveSettings);
	}

	async function handleIdleTimeoutChange(idleTimeout: number) {
		autoSaveSettings = { ...autoSaveSettings, idleTimeout };
		await autoSaveManager.updateSettings(autoSaveSettings);
	}

	function startCreateTheme() {
		isCreatingTheme = true;
		customThemeName = '';
		customThemeDisplayName = '';

		const baseTheme = $allThemes[selectedBaseTheme];
		if (baseTheme) {
			customColors = {
				background: baseTheme.colors.background,
				primary: baseTheme.colors.primary,
				text: baseTheme.colors.text,
				border: baseTheme.colors.border,
				success: baseTheme.colors.success,
				warning: baseTheme.colors.warning,
				error: baseTheme.colors.error,
			};
		}
	}

	function cancelCreateTheme() {
		isCreatingTheme = false;
		customThemeName = '';
		customThemeDisplayName = '';
	}

	function saveCustomTheme() {
		if (!customThemeName || !customThemeDisplayName) return;

		const baseTheme = $allThemes[selectedBaseTheme];
		if (!baseTheme) return;

		createCustomTheme(
			selectedBaseTheme,
			`custom-${customThemeName}`,
			customThemeDisplayName,
			{
				background: customColors.background as `#${string}`,
				primary: customColors.primary as `#${string}`,
				primaryHover: adjustColor(customColors.primary, -20) as `#${string}`,
				text: customColors.text as `#${string}`,
				border: customColors.border as `#${string}`,
				borderFocus: customColors.primary as `#${string}`,
				success: customColors.success as `#${string}`,
				warning: customColors.warning as `#${string}`,
				error: customColors.error as `#${string}`,
			}
		);

		themePreference.set(`custom-${customThemeName}`);
		isCreatingTheme = false;
		customThemeName = '';
		customThemeDisplayName = '';
	}

	function removeCustomTheme(themeName: string) {
		if (confirm('Are you sure you want to delete this custom theme?')) {
			deleteCustomTheme(themeName);
			if ($themePreference === themeName) {
				themePreference.set('system');
			}
		}
	}

	function adjustColor(hex: string, percent: number): string {
		const num = parseInt(hex.replace("#", ""), 16);
		const amt = Math.round(2.55 * percent);
		const R = (num >> 16) + amt;
		const G = (num >> 8 & 0x00FF) + amt;
		const B = (num & 0x0000FF) + amt;
		return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
			(G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
			(B < 255 ? B < 1 ? 0 : B : 255))
			.toString(16).slice(1);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<BaseModal
	bind:visible={show}
	title="Settings"
	subtitle="Customize your experience"
	icon="settings"
	width="lg"
	showFooter={false}
	onclose={close}
>
	<div class="modal-body">
			<!-- Sidebar Navigation -->
			<div class="sidebar" role="tablist">
				{#each tabs as tab}
					<button
						class="nav-item"
						class:active={activeTab === tab.id}
						onclick={() => activeTab = tab.id}
						role="tab"
						aria-selected={activeTab === tab.id}
					>
						<Icon name={tab.icon} size={18} />
						<span>{tab.label}</span>
					</button>
				{/each}
			</div>

			<!-- Main Content -->
			<main class="content">
				{#if activeTab === 'general'}
					<div class="panel" role="tabpanel">
						<div class="panel-header">
							<h2>General Settings</h2>
							<p>Configure application behavior and preferences</p>
						</div>

						<!-- Auto Save Section -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="autosave" size={20} />
								<h3>Auto Save</h3>
							</div>

							<div class="setting-card">
								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Enable Auto Save</span>
										<span class="setting-description">Automatically save your changes</span>
									</div>
									<label class="toggle">
										<input
											type="checkbox"
											checked={autoSaveSettings.enabled}
											onchange={(e) => handleAutoSaveToggle((e.target as HTMLInputElement).checked)}
										/>
										<span class="toggle-slider"></span>
									</label>
								</div>

								{#if autoSaveSettings.enabled}
									<div class="setting-row">
										<div class="setting-info">
											<span class="setting-label">Save Interval</span>
											<span class="setting-description">How often to auto-save (in seconds)</span>
										</div>
										<div class="input-group compact">
											<input
												type="number"
												class="input small"
												value={autoSaveSettings.interval}
												min={5}
												max={300}
												onchange={(e) => handleAutoSaveIntervalChange(parseInt((e.target as HTMLInputElement).value) || 30)}
											/>
											<span class="input-suffix">sec</span>
										</div>
									</div>

									<div class="setting-row">
										<div class="setting-info">
											<span class="setting-label">Save on Idle</span>
											<span class="setting-description">Save when you stop typing</span>
										</div>
										<label class="toggle">
											<input
												type="checkbox"
												checked={autoSaveSettings.saveOnIdle}
												onchange={(e) => handleSaveOnIdleToggle((e.target as HTMLInputElement).checked)}
											/>
											<span class="toggle-slider"></span>
										</label>
									</div>

									{#if autoSaveSettings.saveOnIdle}
										<div class="setting-row">
											<div class="setting-info">
												<span class="setting-label">Idle Timeout</span>
												<span class="setting-description">Wait time before saving on idle</span>
											</div>
											<div class="input-group compact">
												<input
													type="number"
													class="input small"
													value={autoSaveSettings.idleTimeout}
													min={1}
													max={60}
													onchange={(e) => handleIdleTimeoutChange(parseInt((e.target as HTMLInputElement).value) || 5)}
												/>
												<span class="input-suffix">sec</span>
											</div>
										</div>
									{/if}
								{/if}
							</div>
						</section>

						<!-- Keyboard Shortcuts Section -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="shortcuts" size={20} />
								<h3>Keyboard Shortcuts</h3>
							</div>

							<div class="shortcuts-grid">
								<div class="shortcut-item">
									<span class="shortcut-label">New File</span>
									<kbd>Ctrl+N</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Open File</span>
									<kbd>Ctrl+O</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Save File</span>
									<kbd>Ctrl+S</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Format JSON</span>
									<kbd>Shift+Alt+F</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Find & Replace</span>
									<kbd>Ctrl+H</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Undo</span>
									<kbd>Ctrl+Z</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Redo</span>
									<kbd>Ctrl+Y</kbd>
								</div>
								<div class="shortcut-item">
									<span class="shortcut-label">Show Shortcuts</span>
									<kbd>Ctrl+K</kbd>
								</div>
							</div>
						</section>
					</div>

				{:else if activeTab === 'editor'}
					<div class="panel" role="tabpanel">
						<div class="panel-header">
							<h2>Editor Settings</h2>
							<p>Customize the code editor appearance and behavior</p>
						</div>

						<!-- Font Section -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="text-view" size={20} />
								<h3>Font</h3>
							</div>

							<div class="setting-card">
								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Font Family</span>
										<span class="setting-description">Choose your preferred code font</span>
									</div>
									<Select
										value={$preferences.editor.fontFamily}
										options={[
											{ value: 'JetBrains Mono', label: 'JetBrains Mono' },
											{ value: 'Fira Code', label: 'Fira Code' },
											{ value: 'Cascadia Code', label: 'Cascadia Code' },
											{ value: 'Consolas', label: 'Consolas' },
											{ value: 'Monaco', label: 'Monaco' }
										]}
										onchange={(v: string) => preferencesService.update({ editor: { ...$preferences.editor, fontFamily: v } })}
									/>
								</div>

								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Font Size</span>
										<span class="setting-description">Editor font size in pixels</span>
									</div>
									<div class="input-group compact">
										<input
											type="number"
											class="input small"
											value={$preferences.editor.fontSize}
											min={10}
											max={24}
											onchange={(e) => {
												const val = parseInt((e.target as HTMLInputElement).value, 10) || 14;
												preferencesService.update({ editor: { ...$preferences.editor, fontSize: val } });
											}}
										/>
										<span class="input-suffix">px</span>
									</div>
								</div>
							</div>
						</section>

						<!-- Display Section -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="visualize" size={20} />
								<h3>Display</h3>
							</div>

							<div class="setting-card">
								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Line Numbers</span>
										<span class="setting-description">Show line numbers in the editor</span>
									</div>
									<label class="toggle">
										<input
											type="checkbox"
											checked={$preferences.editor.showLineNumbers}
											onchange={(e) => {
												const checked = (e.target as HTMLInputElement).checked;
												preferencesService.update({ editor: { ...$preferences.editor, showLineNumbers: checked } });
											}}
										/>
										<span class="toggle-slider"></span>
									</label>
								</div>

								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Word Wrap</span>
										<span class="setting-description">Wrap long lines to fit the editor width</span>
									</div>
									<label class="toggle">
										<input
											type="checkbox"
											checked={$preferences.editor.wordWrap}
											onchange={(e) => {
												const checked = (e.target as HTMLInputElement).checked;
												preferencesService.update({ editor: { ...$preferences.editor, wordWrap: checked } });
											}}
										/>
										<span class="toggle-slider"></span>
									</label>
								</div>
							</div>
						</section>
					</div>

				{:else if activeTab === 'appearance'}
					<div class="panel" role="tabpanel">
						<div class="panel-header">
							<h2>Appearance</h2>
							<p>Customize the look and feel of the application</p>
						</div>

						<!-- Theme Section -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="theme-auto" size={20} />
								<h3>Theme</h3>
							</div>

							<div class="setting-card">
								<div class="setting-row">
									<div class="setting-info">
										<span class="setting-label">Theme Mode</span>
										<span class="setting-description">Choose your preferred color scheme</span>
									</div>
									<div class="theme-switcher">
										<button
											class="theme-option"
											class:active={$themePreference === 'system'}
											onclick={() => themePreference.set('system')}
											title="System"
										>
											<Icon name="theme-auto" size={18} />
										</button>
										<button
											class="theme-option"
											class:active={$themePreference === 'light'}
											onclick={() => themePreference.set('light')}
											title="Light"
										>
											<Icon name="theme-light" size={18} />
										</button>
										<button
											class="theme-option"
											class:active={$themePreference === 'dark'}
											onclick={() => themePreference.set('dark')}
											title="Dark"
										>
											<Icon name="theme-dark" size={18} />
										</button>
									</div>
								</div>
							</div>
						</section>

						<!-- Theme Gallery -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="file-new" size={20} />
								<h3>Theme Gallery</h3>
							</div>

							<div class="theme-gallery">
								{#each Object.values($allThemes) as theme}
									<div
										class="theme-card"
										class:active={$themePreference === theme.name}
										onclick={() => themePreference.set(theme.name)}
										onkeydown={(e) => e.key === 'Enter' && themePreference.set(theme.name)}
										role="button"
										tabindex="0"
										aria-pressed={$themePreference === theme.name}
									>
										<div class="theme-preview" style="background: {theme.colors.background}">
											<div class="preview-dots">
												<span style="background: {theme.colors.primary}"></span>
												<span style="background: {theme.colors.success}"></span>
												<span style="background: {theme.colors.warning}"></span>
												<span style="background: {theme.colors.error}"></span>
											</div>
										</div>
										<div class="theme-meta">
											<span class="theme-name">{theme.displayName}</span>
											{#if theme.type === 'custom'}
												<button
													class="delete-theme"
													onclick={(e) => { e.stopPropagation(); removeCustomTheme(theme.name); }}
													title="Delete theme"
												>
													<Icon name="close" size={12} />
												</button>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</section>

						<!-- Custom Theme Creator -->
						<section class="settings-section">
							<div class="section-header">
								<Icon name="format" size={20} />
								<h3>Custom Theme</h3>
							</div>

							{#if !isCreatingTheme}
								<button class="btn btn-secondary" onclick={startCreateTheme}>
									<Icon name="file-new" size={16} />
									Create Custom Theme
								</button>
							{:else}
								<div class="theme-creator">
									<div class="creator-row">
										<div class="creator-field">
											<span id="base-theme-label" class="field-label">Base Theme</span>
								
											<Select
												labelledby="base-theme-label"
												bind:value={selectedBaseTheme}
												options={Object.values($allThemes)
													.filter(theme => theme.type !== 'custom')
													.map(theme => ({ value: theme.name, label: theme.displayName }))}
											/>
										</div>
									</div>

									<div class="creator-row">
										<div class="creator-field">
											<label for="theme-id-input">Theme ID</label>
											<input
												id="theme-id-input"
												class="input"
												type="text"
												placeholder="my-theme"
												bind:value={customThemeName}
												autocomplete="off"
												autocapitalize="off"
												spellcheck="false"
											/>
										</div>
										<div class="creator-field">
											<label for="theme-display-name-input">Display Name</label>
											<input
												id="theme-display-name-input"
												class="input"
												type="text"
												placeholder="My Custom Theme"
												bind:value={customThemeDisplayName}
												autocomplete="off"
												autocapitalize="off"
											/>
										</div>
									</div>

									<div class="color-editor">
										<span class="color-editor-label">Colors</span>
										<div class="color-grid">
											{#each Object.keys(customColors) as key (key)}
												<div class="color-picker">
													<input
														type="color"
														value={customColors[key as keyof typeof customColors]}
														onchange={(e) => customColors[key as keyof typeof customColors] = (e.target as HTMLInputElement).value}
													/>
													<span>{key}</span>
												</div>
											{/each}
										</div>
									</div>

									<div class="creator-actions">
										<button class="btn btn-primary" onclick={saveCustomTheme}>
											Save Theme
										</button>
										<button class="btn btn-ghost" onclick={cancelCreateTheme}>
											Cancel
										</button>
									</div>
								</div>
							{/if}
						</section>
					</div>
				{/if}
			</main>
	</div>
</BaseModal>

<style>
	.modal-body {
		display: flex;
		height: 550px;
	}

	.sidebar {
		width: 180px;
		background: var(--color-background-secondary);
		border-right: 1px solid var(--color-border);
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: none;
		border: none;
		border-radius: var(--border-radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: var(--font-size-sm);
		text-align: left;
		transition: all 0.15s;
	}

	.nav-item:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.nav-item.active {
		background: var(--color-primary);
		color: var(--color-text-inverted);
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: var(--spacing-lg);
	}

	.panel-header {
		margin-bottom: var(--spacing-xl);
	}

	.panel-header h2 {
		margin: 0 0 var(--spacing-xs) 0;
		color: var(--color-text);
		font-size: var(--font-size-xl);
		font-weight: 600;
	}

	.panel-header p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
	}

	.settings-section {
		margin-bottom: var(--spacing-xl);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
		color: var(--color-text);
	}

	.section-header h3 {
		margin: 0;
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.setting-card {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		overflow: hidden;
	}

	.setting-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.setting-row:last-child {
		border-bottom: none;
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.setting-label {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text);
	}

	.setting-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 44px;
		height: 24px;
		cursor: pointer;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		inset: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		transition: all 0.2s;
	}

	.toggle-slider::before {
		content: '';
		position: absolute;
		width: 18px;
		height: 18px;
		left: 2px;
		top: 2px;
		background: var(--color-text-secondary);
		border-radius: 50%;
		transition: all 0.2s;
	}

	.toggle input:checked + .toggle-slider {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	.toggle input:checked + .toggle-slider::before {
		transform: translateX(20px);
		background: white;
	}

	/* Input Group */
	.input-group {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.input-group.compact {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		padding: 0 var(--spacing-sm);
	}

	.input.small {
		width: 60px;
		padding: var(--spacing-xs);
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: var(--font-size-sm);
		text-align: right;
	}

	.input.small:focus {
		outline: none;
	}

	.input-suffix {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	/* Shortcuts Grid */
	.shortcuts-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--spacing-sm);
	}

	.shortcut-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
	}

	.shortcut-label {
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	kbd {
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-background-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
	}

	/* Theme Switcher */
	.theme-switcher {
		display: flex;
		gap: var(--spacing-xs);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		padding: 2px;
	}

	.theme-option {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: var(--border-radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.theme-option:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.theme-option.active {
		background: var(--color-primary);
		color: var(--color-text-inverted);
	}

	/* Theme Gallery */
	.theme-gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--spacing-md);
	}

	.theme-card {
		background: var(--color-surface-secondary);
		border: 2px solid var(--color-border);
		border-radius: var(--border-radius-md);
		overflow: hidden;
		cursor: pointer;
		transition: all 0.15s;
	}

	.theme-card:hover {
		border-color: var(--color-primary);
	}

	.theme-card.active {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb, 59, 130, 246), 0.2);
	}

	.theme-preview {
		height: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-dots {
		display: flex;
		gap: 4px;
	}

	.preview-dots span {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.theme-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm);
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
	}

	.theme-name {
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--color-text);
	}

	.delete-theme {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		border-radius: var(--border-radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.delete-theme:hover {
		background: var(--color-error);
		color: white;
	}

	/* Theme Creator */
	.theme-creator {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
	}

	.creator-row {
		display: flex;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.creator-field {
		flex: 1;
	}

	.creator-field label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.input {
		width: 100%;
		padding: var(--spacing-sm);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		color: var(--color-text);
		font-size: var(--font-size-sm);
	}

	.input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.color-editor {
		margin-bottom: var(--spacing-md);
	}

	.color-editor > .color-editor-label {
		display: block;
		margin-bottom: var(--spacing-sm);
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.color-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		gap: var(--spacing-sm);
	}

	.color-picker {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.color-picker input {
		width: 100%;
		height: 32px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		cursor: pointer;
	}

	.color-picker span {
		font-size: 10px;
		color: var(--color-text-secondary);
	}

	.creator-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-md);
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

	.btn-secondary {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn-ghost:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	/* Responsive */
	@media (max-width: 768px) {
		.modal-body {
			flex-direction: column;
			height: auto;
		}

		.sidebar {
			width: 100%;
			flex-direction: row;
			overflow-x: auto;
			border-right: none;
			border-bottom: 1px solid var(--color-border);
		}

		.nav-item {
			white-space: nowrap;
		}

		.shortcuts-grid {
			grid-template-columns: 1fr;
		}

		.creator-row {
			flex-direction: column;
		}
	}
</style>
