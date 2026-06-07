export interface ThemeColors {
	bg: string;
	bgElev: string;
	bgElev2: string;
	bgElev3: string;
	bgEdit: string;
	rule: string;
	rule2: string;
	text: string;
	textDim: string;
	textFaint: string;
	textGhost: string;
	accent: string;
	accentSoft: string;
	accentLine: string;
	accentFill: string;
	accent2: string; // secondary/decorative accent (paths, search marks, headings)
	syntaxString: string;
	syntaxNumber: string;
	syntaxBoolean: string;
	syntaxNull: string;
	syntaxPunct: string;
	syntaxUrl: string;
	success: string;
	warning: string;
	danger: string;
}

export interface Theme {
	id: string;
	label: string;
	colorScheme: 'dark' | 'light';
	colors: ThemeColors;
}

export {
	DEFAULT_THEME,
	LIGHT_THEME,
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
	GITHUB_DARK,
	GITHUB_LIGHT,
	GRUVBOX_DARK,
	GRUVBOX_LIGHT,
	ONE_DARK,
	ONE_LIGHT,
	TOKYO_NIGHT,
	TOKYO_NIGHT_LIGHT,
	CATPPUCCIN_MOCHA,
	CATPPUCCIN_LATTE,
	DRACULA,
	NORD,
	MONOKAI,
	HC_DARK,
	HC_LIGHT,
	THEMES,
	THEME_FAMILIES,
	familyOf,
	type ThemeFamily,
} from './theme-palettes';

import { DEFAULT_THEME } from './theme-palettes';

export const APPEARANCE_CHANGE_EVENT = 'pandia:appearance-change';

function emitAppearanceChange(): void {
	window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export function applyTheme(theme: Theme): void {
	const r = document.documentElement;
	r.style.setProperty('--bg', theme.colors.bg);
	r.style.setProperty('--bg-elev', theme.colors.bgElev);
	r.style.setProperty('--bg-elev-2', theme.colors.bgElev2);
	r.style.setProperty('--bg-elev-3', theme.colors.bgElev3);
	r.style.setProperty('--bg-edit', theme.colors.bgEdit);
	r.style.setProperty('--rule', theme.colors.rule);
	r.style.setProperty('--rule-2', theme.colors.rule2);
	r.style.setProperty('--text', theme.colors.text);
	r.style.setProperty('--text-dim', theme.colors.textDim);
	r.style.setProperty('--text-faint', theme.colors.textFaint);
	r.style.setProperty('--text-ghost', theme.colors.textGhost);
	r.style.setProperty('--accent', theme.colors.accent);
	r.style.setProperty('--accent-soft', theme.colors.accentSoft);
	r.style.setProperty('--accent-line', theme.colors.accentLine);
	r.style.setProperty('--accent-fill', theme.colors.accentFill);
	r.style.setProperty('--accent-2', theme.colors.accent2);
	r.style.setProperty('--syntax-string', theme.colors.syntaxString);
	r.style.setProperty('--syntax-number', theme.colors.syntaxNumber);
	r.style.setProperty('--syntax-boolean', theme.colors.syntaxBoolean);
	r.style.setProperty('--syntax-null', theme.colors.syntaxNull);
	r.style.setProperty('--syntax-punct', theme.colors.syntaxPunct);
	r.style.setProperty('--syntax-url', theme.colors.syntaxUrl);
	r.style.setProperty('--success', theme.colors.success);
	r.style.setProperty('--warning', theme.colors.warning);
	r.style.setProperty('--danger', theme.colors.danger);
	r.style.setProperty('color-scheme', theme.colorScheme);
	emitAppearanceChange();
}

export type Density = 'compact' | 'normal' | 'comfortable';

export interface DensityTokens {
	tight: string;
	base: string;
	loose: string;
	lineHeight: string;
}

const DENSITY_PRESETS: Record<Density, DensityTokens> = {
	compact: { tight: '0.2rem', base: '0.4rem', loose: '0.8rem', lineHeight: '1.4' },
	normal: { tight: '0.25rem', base: '0.5rem', loose: '1rem', lineHeight: '1.55' },
	comfortable: { tight: '0.3rem', base: '0.6rem', loose: '1.2rem', lineHeight: '1.7' },
};

export function applyDensity(density: Density): void {
	const t = DENSITY_PRESETS[density];
	const r = document.documentElement;
	r.style.setProperty('--space-tight', t.tight);
	r.style.setProperty('--space-base', t.base);
	r.style.setProperty('--space-loose', t.loose);
	r.style.setProperty('--line-height', t.lineHeight);
	emitAppearanceChange();
}

export function applyFontFamily(opts: { mono?: string; sans?: string }): void {
	const r = document.documentElement;
	if (opts.mono) {
		const stack = `'${opts.mono}', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
		r.style.setProperty('--font-mono', stack);
	}
	if (opts.sans) {
		const stack = `'${opts.sans}', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
		r.style.setProperty('--font-sans', stack);
	}
	emitAppearanceChange();
}

export function applyFontSizeBase(px: number): void {
	const clamped = Math.max(10, Math.min(20, px));
	const r = document.documentElement;
	r.style.setProperty('--font-size-base', `${clamped}px`);
	r.style.setProperty('--font-size-sm', `${((clamped * 11) / 12.5).toFixed(2)}px`);
	r.style.setProperty('--font-size-xs', `${((clamped * 10.5) / 12.5).toFixed(2)}px`);
	emitAppearanceChange();
}

export function resetAppearance(): void {
	applyTheme(DEFAULT_THEME);
	applyDensity('normal');
	const r = document.documentElement;
	r.style.removeProperty('--font-mono');
	r.style.removeProperty('--font-sans');
	r.style.removeProperty('--font-size-base');
	r.style.removeProperty('--font-size-sm');
	r.style.removeProperty('--font-size-xs');
	emitAppearanceChange();
}
