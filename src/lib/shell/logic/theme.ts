import { contrastRatio, luminance, mixHex, withAlpha } from '$lib/util/color';

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
	setDerivedShades(r, theme);
	r.style.setProperty('color-scheme', theme.colorScheme);
	emitAppearanceChange();
}

const SOFT_MIX = 0.14;
const HOVER_MIX = 0.15;
const LINE_TINT = 0.05;
const DIFF_TINT = 0.18;

// Shades are mixed into solid colours per theme rather than layered with opacity.
function setDerivedShades(r: HTMLElement, theme: Theme): void {
	const c = theme.colors;
	const onAccent = readableOn(c.accent, c.bg);
	r.style.setProperty('--on-accent', onAccent);
	r.style.setProperty('--accent-hover', hoverShade(c.accent, onAccent));
	r.style.setProperty('--danger-hover', hoverShade(c.danger, c.bg));
	r.style.setProperty('--danger-soft', mixHex(c.bg, c.danger, SOFT_MIX));
	r.style.setProperty('--success-soft', mixHex(c.bg, c.success, SOFT_MIX));
	r.style.setProperty('--warning-soft', mixHex(c.bg, c.warning, SOFT_MIX));
	r.style.setProperty('--moved-soft', mixHex(c.bg, c.syntaxBoolean, SOFT_MIX));
	// Editor highlights sit above CodeMirror's selection layer, so they must stay translucent.
	r.style.setProperty('--line-tint', withAlpha(c.text, LINE_TINT));
	r.style.setProperty('--danger-tint', withAlpha(c.danger, DIFF_TINT));
	r.style.setProperty('--success-tint', withAlpha(c.success, DIFF_TINT));
	r.style.setProperty('--warning-tint', withAlpha(c.warning, DIFF_TINT));
	const light = theme.colorScheme === 'light';
	r.style.setProperty('--shadow-pop', `0 8px 24px rgba(0, 0, 0, ${light ? 0.12 : 0.35})`);
	r.style.setProperty('--shadow-modal', `0 16px 48px rgba(0, 0, 0, ${light ? 0.18 : 0.5})`);
}

// The theme background stays the label colour wherever it reaches WCAG AA on the fill.
function readableOn(fill: string, preferred: string): string {
	if (contrastRatio(preferred, fill) >= 4.5) return preferred;
	return contrastRatio('#111111', fill) >= contrastRatio('#ffffff', fill) ? '#111111' : '#ffffff';
}

// Hover moves the fill away from its label, so the label only gains contrast.
function hoverShade(fill: string, label: string): string {
	return mixHex(fill, luminance(label) < 0.5 ? '#ffffff' : '#000000', HOVER_MIX);
}

export type Density = 'compact' | 'normal' | 'comfortable';

const DENSITY_PRESETS: Record<Density, { scale: number; lineHeight: string }> = {
	compact: { scale: 0.8, lineHeight: '1.4' },
	normal: { scale: 1, lineHeight: '1.55' },
	comfortable: { scale: 1.2, lineHeight: '1.7' },
};

export function applyDensity(density: Density): void {
	const t = DENSITY_PRESETS[density];
	const r = document.documentElement;
	r.style.setProperty('--density', String(t.scale));
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
	r.style.setProperty('--font-size-sm', `${((clamped * 11.5) / 13).toFixed(2)}px`);
	r.style.setProperty('--font-size-xs', `${((clamped * 10.5) / 13).toFixed(2)}px`);
	r.style.setProperty('--font-size-lg', `${((clamped * 16) / 13).toFixed(2)}px`);
	r.style.setProperty('--font-size-title', `${((clamped * 18) / 13).toFixed(2)}px`);
	emitAppearanceChange();
}

export function resetAppearance(): void {
	applyDensity('normal');
	const r = document.documentElement;
	r.style.removeProperty('--font-mono');
	r.style.removeProperty('--font-sans');
	r.style.removeProperty('--font-size-base');
	r.style.removeProperty('--font-size-sm');
	r.style.removeProperty('--font-size-xs');
	r.style.removeProperty('--font-size-lg');
	r.style.removeProperty('--font-size-title');
	emitAppearanceChange();
}
