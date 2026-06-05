<script lang="ts">
	import { appearancePrefs, FONT_SIZE_MIN, FONT_SIZE_MAX } from './state/appearance-prefs.svelte';
	import { THEMES, THEME_FAMILIES, type Theme, type Density } from '$lib/shell/logic/theme';

	$effect(() => {
		void appearancePrefs.init();
	});

	type Mode = 'dark' | 'light' | 'auto';
	let modeOverride = $state<Mode | null>(null);
	const activeTheme = $derived(THEMES[appearancePrefs.themeId]);
	const mode: Mode = $derived(
		modeOverride ?? (appearancePrefs.autoMode ? 'auto' : (activeTheme?.colorScheme ?? 'dark')),
	);

	interface FamilyPick {
		key: string;
		name: string;
		theme: Theme;
		active: boolean;
		apply: () => void;
	}

	const visibleFamilies: FamilyPick[] = $derived(
		THEME_FAMILIES.flatMap((f) => {
			if (mode === 'auto') {
				if (!f.dark || !f.light) return [];
				const darkId = f.dark;
				const theme = THEMES[appearancePrefs.systemPrefersDark ? f.dark : f.light];
				if (!theme) return [];
				const active =
					appearancePrefs.autoMode &&
					(f.dark === appearancePrefs.themeId || f.light === appearancePrefs.themeId);
				return [
					{
						key: f.name,
						name: f.name,
						theme,
						active,
						apply: () => appearancePrefs.setAuto(darkId),
					},
				];
			}
			const id = f[mode];
			const theme = id ? THEMES[id] : undefined;
			if (!id || !theme) return [];
			const active = !appearancePrefs.autoMode && appearancePrefs.themeId === id;
			return [
				{ key: f.name, name: f.name, theme, active, apply: () => appearancePrefs.setTheme(id) },
			];
		}),
	);

	const DENSITY_OPTIONS: Array<{ id: Density; label: string; hint: string }> = [
		{ id: 'compact', label: 'Compact', hint: 'Tighter rows, more on screen' },
		{ id: 'normal', label: 'Normal', hint: 'Default · balanced' },
		{ id: 'comfortable', label: 'Comfortable', hint: 'Looser rows, easier to scan' },
	];

	const FONT_GROUPS: Array<{ title: string; hint: string; fonts: string[] }> = [
		{
			title: 'Bundled',
			hint: 'Shipped with the app — same everywhere.',
			fonts: [
				'IBM Plex Mono',
				'JetBrains Mono',
				'Fira Code',
				'Source Code Pro',
				'Roboto Mono',
				'Space Mono',
				'Inconsolata',
				'Ubuntu Mono',
				'Geist Mono',
				'Cascadia Code',
				'DM Mono',
				'Victor Mono',
			],
		},
		{
			title: 'System',
			hint: 'Only available on certain platforms; falls back if missing.',
			fonts: ['SF Mono', 'Menlo', 'ui-monospace'],
		},
	];

	let customFont = $state('');

	async function pickFont(family: string) {
		await appearancePrefs.setFontFamily(family);
		customFont = '';
	}

	async function applyCustomFont() {
		const f = customFont.trim();
		if (!f) return;
		await appearancePrefs.setFontFamily(f);
	}

	async function onSizeChange(e: Event) {
		const v = parseFloat((e.target as HTMLInputElement).value);
		if (Number.isFinite(v)) await appearancePrefs.setFontSize(v);
	}
</script>

<div class="settings-panel">
	<header class="settings-head">
		<h2 class="settings-title">Appearance</h2>
		<p class="hint text-sm dim">Persisted across launches · changes apply instantly.</p>
	</header>

	
	<section class="field">
		<div class="label">theme</div>
		<div class="field-control">
			<div class="mode-toggle" role="group" aria-label="theme mode">
				<button
					class:active={mode === 'dark'}
					aria-pressed={mode === 'dark'}
					onclick={() => (modeOverride = 'dark')}>Dark</button
				>
				<button
					class:active={mode === 'light'}
					aria-pressed={mode === 'light'}
					onclick={() => (modeOverride = 'light')}>Light</button
				>
				<button
					class:active={mode === 'auto'}
					aria-pressed={mode === 'auto'}
					onclick={() => (modeOverride = 'auto')}>Auto</button
				>
			</div>
			<div class="theme-grid">
				{#each visibleFamilies as f (f.key)}
					<button class="swatch" class:active={f.active} onclick={f.apply} aria-pressed={f.active}>
						<span class="dots" aria-hidden="true">
							<span class="dot" style="background: {f.theme.colors.bg}"></span>
							<span class="dot" style="background: {f.theme.colors.accent}"></span>
							<span class="dot" style="background: {f.theme.colors.syntaxString}"></span>
							<span class="dot" style="background: {f.theme.colors.syntaxNumber}"></span>
						</span>
						<span class="label-l">{f.name}</span>
					</button>
				{/each}
			</div>
			{#if mode === 'light'}
				<div class="dim text-sm note">Dracula, Nord and Monokai are dark-only.</div>
			{:else if mode === 'auto'}
				<div class="dim text-sm note">
					Follows your system appearance (currently {appearancePrefs.systemPrefersDark
						? 'dark'
						: 'light'}). Dark-only families aren't available in Auto.
				</div>
			{/if}
		</div>
	</section>


	<section class="field">
		<div class="label">monospace font</div>
		<div class="field-control">
			{#each FONT_GROUPS as g (g.title)}
				<div class="font-group">
					<div class="font-group-head">
						<span class="font-group-title">{g.title}</span>
						<span class="text-sm dim">{g.hint}</span>
					</div>
					<div class="font-grid">
						{#each g.fonts as f (f)}
							<button
								class="font-pick"
								class:active={appearancePrefs.fontFamily === f}
								onclick={() => pickFont(f)}
								style="font-family: '{f}', ui-monospace, monospace;">{f}</button
							>
						{/each}
					</div>
				</div>
			{/each}
			<div class="font-custom">
				<input
					placeholder="Custom (any installed font)"
					bind:value={customFont}
					onkeydown={(e) => {
						if (e.key === 'Enter') applyCustomFont();
					}}
					aria-label="Custom font family"
					spellcheck="false"
				/>
				<button onclick={applyCustomFont} disabled={!customFont.trim()}>Apply</button>
			</div>
			<div class="text-sm dim">Current: <span class="mono">{appearancePrefs.fontFamily}</span></div>
		</div>
	</section>

	
	<section class="field">
		<div class="label">font size</div>
		<div class="field-control">
			<div class="size-row">
				<input
					type="range"
					min={FONT_SIZE_MIN}
					max={FONT_SIZE_MAX}
					step="0.5"
					value={appearancePrefs.fontSizeBase}
					oninput={onSizeChange}
					aria-label="base font size in pixels"
				/>
				<span class="size-value mono">{appearancePrefs.fontSizeBase.toFixed(1)} px</span>
			</div>
		</div>
	</section>

	
	<section class="field">
		<div class="label">density</div>
		<div class="field-control">
			<div class="density-grid">
				{#each DENSITY_OPTIONS as d (d.id)}
					<button
						class="density-pick"
						class:active={appearancePrefs.density === d.id}
						onclick={() => appearancePrefs.setDensity(d.id)}
					>
						<span class="density-label">{d.label}</span>
						<span class="text-sm dim">{d.hint}</span>
					</button>
				{/each}
			</div>
		</div>
	</section>

	
	<section class="field">
		<div class="label"></div>
		<div class="field-control">
			<button class="reset" onclick={() => appearancePrefs.reset()}>Restore defaults</button>
		</div>
	</section>
</div>

<style>
	.hint {
		margin: 0;
	}
	.mono {
		font-family: var(--font-mono);
	}
	.note {
		margin-top: 0.5rem;
	}

	
	.label {
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
		padding-top: 0.2rem;
	}

	.mode-toggle {
		display: inline-flex;
		width: fit-content;
		border: var(--rule-width) solid var(--rule);
		margin-bottom: 0.6rem;
	}
	.mode-toggle button {
		font-size: var(--font-size-sm);
		padding: 0.2rem 0.9rem;
		background: var(--bg-elev);
		border: none;
		color: var(--text-dim);
	}
	.mode-toggle button + button {
		border-left: var(--rule-width) solid var(--rule);
	}
	.mode-toggle button:hover {
		color: var(--accent);
	}
	.mode-toggle button.active {
		background: var(--accent);
		color: var(--bg);
	}

	.theme-grid {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.swatch {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.5rem 0.6rem;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		color: var(--text);
		text-align: left;
		min-width: 140px;
	}
	.swatch:hover {
		border-color: var(--text-dim);
	}
	.swatch.active {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.dots {
		display: flex;
		gap: 0.2rem;
	}
	.dot {
		width: 14px;
		height: 14px;
		border: var(--rule-width) solid rgba(255, 255, 255, 0.05);
	}
	.label-l {
		font-size: var(--font-size-sm);
		letter-spacing: 0.05em;
	}

	.font-group + .font-group {
		margin-top: 0.7rem;
	}
	.font-group-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-bottom: 0.3rem;
	}
	.font-group-title {
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: var(--label-tracking);
		font-size: var(--font-size-xs);
	}

	.font-grid {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.font-pick {
		font-size: var(--font-size-sm);
		padding: 0.25rem 0.7rem;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		color: var(--text);
	}
	.font-pick:hover {
		border-color: var(--text-dim);
	}
	.font-pick.active {
		color: var(--bg);
		background: var(--accent);
		border-color: var(--accent);
	}
	.font-custom {
		display: flex;
		gap: 0.3rem;
	}
	.font-custom input {
		flex: 1;
		min-width: 0;
		font-size: var(--font-size-sm);
		padding: 0.25rem 0.5rem;
	}
	.font-custom button {
		font-size: var(--font-size-sm);
		padding: 0.25rem 0.7rem;
	}

	.size-row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.size-row input[type='range'] {
		flex: 1;
		min-width: 0;
		background: transparent;
		padding: 0;
		border: none;
		accent-color: var(--accent);
	}
	.size-value {
		min-width: 5ch;
		color: var(--text-dim);
		font-size: var(--font-size-sm);
	}

	.density-grid {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.density-pick {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.5rem 0.8rem;
		background: var(--bg-elev);
		border: var(--rule-width) solid var(--rule);
		color: var(--text);
		text-align: left;
		min-width: 160px;
	}
	.density-pick:hover {
		border-color: var(--text-dim);
	}
	.density-pick.active {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.density-label {
		font-size: var(--font-size-sm);
		letter-spacing: 0.04em;
	}

	.reset {
		font-size: var(--font-size-sm);
		padding: 0.3rem 0.8rem;
		background: transparent;
		color: var(--text-dim);
		border: var(--rule-width) solid var(--rule);
		align-self: flex-start;
	}
	.reset:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
</style>
