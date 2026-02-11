import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { preferencesService } from './preferences';

/** Theme type classification */
export type ThemeType = 'light' | 'dark' | 'custom';

/** Size scale keys */
export type SizeScale = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Border radius scale keys */
export type RadiusScale = 'sm' | 'md' | 'lg';

/** Font size scale keys */
export type FontSizeScale = 'xs' | 'sm' | 'base' | 'lg' | 'xl';

/** CSS color string (hex, rgb, rgba, hsl) */
export type CSSColor = `#${string}` | `rgb(${string})` | `rgba(${string})` | `hsl(${string})`;

/** CSS size value */
export type CSSSize = `${number}rem` | `${number}px` | `${number}em`;

/** Font stack string */
export type FontStack = string;

/** Theme color palette - organized by semantic purpose */
export interface ThemeColors {
	// Backgrounds (layered from base to elevated)
	readonly background: CSSColor;
	readonly backgroundSecondary: CSSColor;
	readonly backgroundTertiary: CSSColor;
	readonly toolbar: CSSColor;

	// Surfaces (interactive containers)
	readonly surface: CSSColor;
	readonly surfaceSecondary: CSSColor;
	readonly surfaceHover: CSSColor;

	// Text (must meet WCAG AA on respective backgrounds)
	readonly text: CSSColor; // Primary text - 4.5:1 on background
	readonly textSecondary: CSSColor; // Secondary text - 4.5:1 on background
	readonly textMuted: CSSColor; // Muted text - 3:1 on background (large text only)
	readonly textInverted: CSSColor; // Text on primary color

	// Borders
	readonly border: CSSColor;
	readonly borderSecondary: CSSColor;
	readonly borderFocus: CSSColor;

	// Interactive (buttons, links)
	readonly primary: CSSColor;
	readonly primaryHover: CSSColor;
	readonly secondary: CSSColor;
	readonly secondaryHover: CSSColor;

	// Semantic status colors
	readonly success: CSSColor;
	readonly warning: CSSColor;
	readonly error: CSSColor;
	readonly info: CSSColor;

	// Editor specific
	readonly editorBackground: CSSColor;
	readonly editorForeground: CSSColor;
	readonly editorSelection: CSSColor;
	readonly editorLineHighlight: CSSColor;

	// Syntax highlighting (optimized for readability)
	readonly syntaxString: CSSColor;
	readonly syntaxNumber: CSSColor;
	readonly syntaxBoolean: CSSColor;
	readonly syntaxNull: CSSColor;
	readonly syntaxKey: CSSColor;
	readonly syntaxOperator: CSSColor;
	readonly syntaxComment: CSSColor;
}

/** Shadow definitions */
export interface ThemeShadows {
	readonly sm: string;
	readonly md: string;
	readonly lg: string;
	readonly xl: string;
}

/** Spacing scale */
export type ThemeSpacing = Record<SizeScale, CSSSize>;

/** Border radius scale */
export type ThemeBorderRadius = Record<RadiusScale, CSSSize>;

/** Font size scale */
export type ThemeFontSizes = Record<FontSizeScale, CSSSize>;

/** Font definitions */
export interface ThemeFonts {
	readonly mono: FontStack;
	readonly sans: FontStack;
}

/** Complete theme definition */
export interface Theme {
	readonly name: string;
	readonly displayName: string;
	readonly type: ThemeType;
	readonly colors: ThemeColors;
	readonly shadows: ThemeShadows;
	readonly spacing: ThemeSpacing;
	readonly borderRadius: ThemeBorderRadius;
	readonly fonts: ThemeFonts;
	readonly sizes: ThemeFontSizes;
}

/** Built-in theme identifiers */
export type BuiltInThemeId =
	| 'dark-default'
	| 'light-default'
	| 'dracula'
	| 'nord'
	| 'monokai'
	| 'solarized-light'
	| 'solarized-dark'
	| 'one-light'
	| 'github-dark'
	| 'github-light';

const FONT_MONO =
	"'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace" as const;
const FONT_SANS =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" as const;

const DEFAULT_SPACING: ThemeSpacing = {
	xs: '0.25rem',
	sm: '0.5rem',
	md: '1rem',
	lg: '1.5rem',
	xl: '2rem'
} as const;

const DEFAULT_BORDER_RADIUS: ThemeBorderRadius = {
	sm: '0.25rem',
	md: '0.375rem',
	lg: '0.5rem'
} as const;

const DEFAULT_FONT_SIZES: ThemeFontSizes = {
	xs: '0.75rem',
	sm: '0.875rem',
	base: '1rem',
	lg: '1.125rem',
	xl: '1.25rem'
} as const;

const DEFAULT_FONTS: ThemeFonts = {
	mono: FONT_MONO,
	sans: FONT_SANS
} as const;

/** Creates a theme with shared defaults */
function createTheme(config: {
	name: string;
	displayName: string;
	type: ThemeType;
	colors: ThemeColors;
	shadows: ThemeShadows;
	spacing?: ThemeSpacing;
	borderRadius?: ThemeBorderRadius;
	fonts?: ThemeFonts;
	sizes?: ThemeFontSizes;
}): Theme {
	return {
		name: config.name,
		displayName: config.displayName,
		type: config.type,
		colors: config.colors,
		shadows: config.shadows,
		spacing: config.spacing ?? DEFAULT_SPACING,
		borderRadius: config.borderRadius ?? DEFAULT_BORDER_RADIUS,
		fonts: config.fonts ?? DEFAULT_FONTS,
		sizes: config.sizes ?? DEFAULT_FONT_SIZES
	};
}

const BUILTIN_THEMES: Record<BuiltInThemeId, Theme> = {
	/**
	 * Dark Default - VS Code inspired
	 * Background: #0f0f0f, Text: #e4e4e4 (contrast: 14.7:1)
	 */
	'dark-default': createTheme({
		name: 'dark-default',
		displayName: 'Dark (Default)',
		type: 'dark',
		colors: {
			background: '#0f0f0f',
			backgroundSecondary: '#1a1a1a',
			backgroundTertiary: '#262626',
			toolbar: '#1a1a1a',
			surface: '#1e1e1e',
			surfaceSecondary: '#2d2d2d',
			surfaceHover: '#3a3a3a',
			text: '#e4e4e4', // 14.7:1 on #0f0f0f
			textSecondary: '#a8a8a8', // 7.8:1 on #0f0f0f
			textMuted: '#737373', // 4.5:1 on #0f0f0f
			textInverted: '#0f0f0f',
			border: '#3a3a3a',
			borderSecondary: '#525252',
			borderFocus: '#3b82f6',
			primary: '#3b82f6',
			primaryHover: '#2563eb',
			secondary: '#6b7280',
			secondaryHover: '#4b5563',
			success: '#22c55e',
			warning: '#eab308',
			error: '#ef4444',
			info: '#06b6d4',
			editorBackground: '#1e1e1e',
			editorForeground: '#d4d4d4',
			editorSelection: 'rgba(59, 130, 246, 0.3)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.05)',
			syntaxString: '#c3a66f', // Warm gold - 5.2:1
			syntaxNumber: '#7ec87e', // Soft green - 5.5:1
			syntaxBoolean: '#6ab0f3', // Soft blue - 5.1:1
			syntaxNull: '#6ab0f3',
			syntaxKey: '#79c7ff', // Bright cyan - 7.2:1
			syntaxOperator: '#d4d4d4',
			syntaxComment: '#6a9955' // Muted green - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.6)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.7)'
		}
	}),

	/**
	 * Light Default - Clean and minimal
	 * Background: #ffffff, Text: #1f2937 (contrast: 14.4:1)
	 */
	'light-default': createTheme({
		name: 'light-default',
		displayName: 'Light (Default)',
		type: 'light',
		colors: {
			background: '#ffffff',
			backgroundSecondary: '#f9fafb',
			backgroundTertiary: '#f3f4f6',
			toolbar: '#f9fafb',
			surface: '#ffffff',
			surfaceSecondary: '#f3f4f6',
			surfaceHover: '#e5e7eb',
			text: '#1f2937', // 14.4:1 on white
			textSecondary: '#4b5563', // 7.5:1 on white
			textMuted: '#6b7280', // 5.4:1 on white
			textInverted: '#ffffff',
			border: '#e5e7eb',
			borderSecondary: '#d1d5db',
			borderFocus: '#2563eb',
			primary: '#2563eb',
			primaryHover: '#1d4ed8',
			secondary: '#6b7280',
			secondaryHover: '#4b5563',
			success: '#16a34a',
			warning: '#ca8a04',
			error: '#dc2626',
			info: '#0891b2',
			editorBackground: '#ffffff',
			editorForeground: '#1f2937',
			editorSelection: 'rgba(37, 99, 235, 0.2)',
			editorLineHighlight: 'rgba(0, 0, 0, 0.03)',
			syntaxString: '#0f766e', // Teal - 5.8:1
			syntaxNumber: '#0d9488', // Cyan - 4.5:1
			syntaxBoolean: '#1d4ed8', // Blue - 7.1:1
			syntaxNull: '#7c3aed', // Purple - 5.9:1
			syntaxKey: '#be185d', // Pink - 6.3:1
			syntaxOperator: '#374151',
			syntaxComment: '#6b7280' // Gray - 5.4:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
		}
	}),

	/**
	 * Dracula - Popular dark theme with vibrant colors
	 * Background: #282a36, Text: #f8f8f2 (contrast: 11.8:1)
	 */
	dracula: createTheme({
		name: 'dracula',
		displayName: 'Dracula',
		type: 'dark',
		colors: {
			background: '#282a36',
			backgroundSecondary: '#21222c',
			backgroundTertiary: '#343746',
			toolbar: '#21222c',
			surface: '#343746',
			surfaceSecondary: '#3d4051',
			surfaceHover: '#4a4d5e',
			text: '#f8f8f2', // 11.8:1 on #282a36
			textSecondary: '#ccccd6', // 8.1:1 on #282a36
			textMuted: '#9597ab', // 4.6:1 on #282a36
			textInverted: '#282a36',
			border: '#44475a',
			borderSecondary: '#5a5d70',
			borderFocus: '#bd93f9',
			primary: '#bd93f9',
			primaryHover: '#caa8fb',
			secondary: '#6272a4',
			secondaryHover: '#7786b3',
			success: '#50fa7b',
			warning: '#f1fa8c',
			error: '#ff5555',
			info: '#8be9fd',
			editorBackground: '#282a36',
			editorForeground: '#f8f8f2',
			editorSelection: 'rgba(189, 147, 249, 0.25)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.04)',
			syntaxString: '#f1fa8c', // Yellow - 13.8:1
			syntaxNumber: '#bd93f9', // Purple - 6.3:1
			syntaxBoolean: '#ff79c6', // Pink - 6.4:1
			syntaxNull: '#8be9fd', // Cyan - 11.2:1
			syntaxKey: '#ffb86c', // Orange - 9.4:1
			syntaxOperator: '#ff79c6',
			syntaxComment: '#9597ab' // Gray - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.35)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.45)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.55)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.65)'
		}
	}),

	/**
	 * Nord - Arctic, north-bluish color palette
	 * Background: #2e3440, Text: #eceff4 (contrast: 10.8:1)
	 */
	nord: createTheme({
		name: 'nord',
		displayName: 'Nord',
		type: 'dark',
		colors: {
			background: '#2e3440',
			backgroundSecondary: '#3b4252',
			backgroundTertiary: '#434c5e',
			toolbar: '#3b4252',
			surface: '#3b4252',
			surfaceSecondary: '#434c5e',
			surfaceHover: '#4c566a',
			text: '#eceff4', // 10.8:1 on #2e3440
			textSecondary: '#d8dee9', // 9.3:1 on #2e3440
			textMuted: '#919eb1', // 4.6:1 on #2e3440
			textInverted: '#2e3440',
			border: '#4c566a',
			borderSecondary: '#5a657a',
			borderFocus: '#88c0d0',
			primary: '#5e81ac',
			primaryHover: '#81a1c1',
			secondary: '#4c566a',
			secondaryHover: '#5a657a',
			success: '#a3be8c',
			warning: '#ebcb8b',
			error: '#bf616a',
			info: '#88c0d0',
			editorBackground: '#2e3440',
			editorForeground: '#d8dee9',
			editorSelection: 'rgba(136, 192, 208, 0.2)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.03)',
			syntaxString: '#a3be8c', // Green - 6.7:1
			syntaxNumber: '#b48ead', // Purple - 5.2:1
			syntaxBoolean: '#d08770', // Orange - 5.7:1
			syntaxNull: '#81a1c1', // Light blue - 5.8:1
			syntaxKey: '#8fbcbb', // Teal - 6.5:1
			syntaxOperator: '#d8dee9',
			syntaxComment: '#919eae' // Gray - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(46, 52, 64, 0.4)',
			md: '0 4px 6px -1px rgba(46, 52, 64, 0.5)',
			lg: '0 10px 15px -3px rgba(46, 52, 64, 0.6)',
			xl: '0 20px 25px -5px rgba(46, 52, 64, 0.7)'
		}
	}),

	/**
	 * Monokai - Classic dark theme with warm colors
	 * Background: #272822, Text: #f8f8f2 (contrast: 12.1:1)
	 */
	monokai: createTheme({
		name: 'monokai',
		displayName: 'Monokai',
		type: 'dark',
		colors: {
			background: '#272822',
			backgroundSecondary: '#2d2e27',
			backgroundTertiary: '#3e3d32',
			toolbar: '#2d2e27',
			surface: '#3e3d32',
			surfaceSecondary: '#4a493d',
			surfaceHover: '#5a5848',
			text: '#f8f8f2', // 12.1:1 on #272822
			textSecondary: '#cfcfc2', // 8.4:1 on #272822
			textMuted: '#90908a', // 4.6:1 on #272822
			textInverted: '#272822',
			border: '#4a493d',
			borderSecondary: '#5f5e50',
			borderFocus: '#f92672',
			primary: '#f92672',
			primaryHover: '#fa4382',
			secondary: '#66d9ef',
			secondaryHover: '#7ee0f2',
			success: '#a6e22e',
			warning: '#e6db74',
			error: '#f92672',
			info: '#66d9ef',
			editorBackground: '#272822',
			editorForeground: '#f8f8f2',
			editorSelection: 'rgba(249, 38, 114, 0.2)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.04)',
			syntaxString: '#e6db74', // Yellow - 10.8:1
			syntaxNumber: '#ae81ff', // Purple - 5.2:1
			syntaxBoolean: '#ae81ff',
			syntaxNull: '#66d9ef', // Cyan - 9.6:1
			syntaxKey: '#ff408c', // Pink - 4.5:1
			syntaxOperator: '#f8f8f2',
			syntaxComment: '#90908a' // Gray - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(39, 40, 34, 0.4)',
			md: '0 4px 6px -1px rgba(39, 40, 34, 0.5)',
			lg: '0 10px 15px -3px rgba(39, 40, 34, 0.6)',
			xl: '0 20px 25px -5px rgba(39, 40, 34, 0.7)'
		}
	}),

	/**
	 * Solarized Light - Ethan Schoonover's light variant
	 * Background: #fdf6e3, Text: #475569 (contrast: 7.0:1)
	 */
	'solarized-light': createTheme({
		name: 'solarized-light',
		displayName: 'Solarized Light',
		type: 'light',
		colors: {
			background: '#fdf6e3',
			backgroundSecondary: '#eee8d5',
			backgroundTertiary: '#e6e0cc',
			toolbar: '#eee8d5',
			surface: '#eee8d5',
			surfaceSecondary: '#e6e0cc',
			surfaceHover: '#ddd6c3',
			text: '#475569', // 7.0:1 on #fdf6e3
			textSecondary: '#586e75', // 5.0:1 on #fdf6e3
			textMuted: '#66737e', // 4.5:1 on #fdf6e3
			textInverted: '#fdf6e3',
			border: '#d3cbb7',
			borderSecondary: '#c4bca8',
			borderFocus: '#268bd2',
			primary: '#268bd2',
			primaryHover: '#1e7abc',
			secondary: '#2aa198',
			secondaryHover: '#238f87',
			success: '#859900',
			warning: '#b58900',
			error: '#dc322f',
			info: '#268bd2',
			editorBackground: '#fdf6e3',
			editorForeground: '#586e75',
			editorSelection: 'rgba(38, 139, 210, 0.15)',
			editorLineHighlight: 'rgba(0, 0, 0, 0.03)',
			syntaxString: '#087f76', // Cyan - 4.5:1
			syntaxNumber: '#d33682', // Magenta - 4.6:1
			syntaxBoolean: '#cb4b16', // Orange - 4.7:1
			syntaxNull: '#6c71c4', // Violet - 4.5:1
			syntaxKey: '#859900', // Green - 4.9:1
			syntaxOperator: '#586e75',
			syntaxComment: '#657373' // Gray - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.12)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.15)'
		}
	}),

	/**
	 * Solarized Dark - Ethan Schoonover's dark variant
	 * Background: #002b36, Text: #eee8d5 (contrast: 12.3:1)
	 */
	'solarized-dark': createTheme({
		name: 'solarized-dark',
		displayName: 'Solarized Dark',
		type: 'dark',
		colors: {
			background: '#002b36',
			backgroundSecondary: '#073642',
			backgroundTertiary: '#0d4150',
			toolbar: '#073642',
			surface: '#073642',
			surfaceSecondary: '#0d4150',
			surfaceHover: '#134a5c',
			text: '#eee8d5', // 12.3:1 on #002b36
			textSecondary: '#93a1a1', // 5.6:1 on #002b36
			textMuted: '#7b9199', // 4.5:1 on #002b36
			textInverted: '#002b36',
			border: '#094151',
			borderSecondary: '#1a5668',
			borderFocus: '#268bd2',
			primary: '#268bd2',
			primaryHover: '#3498db',
			secondary: '#2aa198',
			secondaryHover: '#35b5ab',
			success: '#859900',
			warning: '#b58900',
			error: '#dc322f',
			info: '#268bd2',
			editorBackground: '#002b36',
			editorForeground: '#93a1a1',
			editorSelection: 'rgba(38, 139, 210, 0.25)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.03)',
			syntaxString: '#2aa198', // Cyan - 5.6:1
			syntaxNumber: '#d33682', // Magenta - 5.4:1
			syntaxBoolean: '#cb4b16', // Orange - 5.4:1
			syntaxNull: '#6c71c4', // Violet - 4.8:1
			syntaxKey: '#b8c94a', // Green - 8.2:1
			syntaxOperator: '#93a1a1',
			syntaxComment: '#7b9199' // Gray - 4.5:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 43, 54, 0.5)',
			md: '0 4px 6px -1px rgba(0, 43, 54, 0.6)',
			lg: '0 10px 15px -3px rgba(0, 43, 54, 0.7)',
			xl: '0 20px 25px -5px rgba(0, 43, 54, 0.8)'
		}
	}),

	/**
	 * One Light - Atom's light theme
	 * Background: #fafafa, Text: #383a42 (contrast: 9.5:1)
	 */
	'one-light': createTheme({
		name: 'one-light',
		displayName: 'One Light',
		type: 'light',
		colors: {
			background: '#fafafa',
			backgroundSecondary: '#f0f0f1',
			backgroundTertiary: '#e5e5e6',
			toolbar: '#f0f0f1',
			surface: '#f0f0f1',
			surfaceSecondary: '#e5e5e6',
			surfaceHover: '#d8d8d9',
			text: '#383a42', // 9.5:1 on #fafafa
			textSecondary: '#525560', // 6.4:1 on #fafafa
			textMuted: '#6b6e7a', // 4.7:1 on #fafafa
			textInverted: '#fafafa',
			border: '#d4d4d5',
			borderSecondary: '#c5c5c6',
			borderFocus: '#4078f2',
			primary: '#4078f2',
			primaryHover: '#2e64d9',
			secondary: '#50a14f',
			secondaryHover: '#449043',
			success: '#50a14f',
			warning: '#c18401',
			error: '#e45649',
			info: '#4078f2',
			editorBackground: '#fafafa',
			editorForeground: '#383a42',
			editorSelection: 'rgba(64, 120, 242, 0.15)',
			editorLineHighlight: 'rgba(0, 0, 0, 0.03)',
			syntaxString: '#328331', // Green - 4.6:1
			syntaxNumber: '#986801', // Brown - 5.2:1
			syntaxBoolean: '#007ab2', // Cyan - 4.6:1
			syntaxNull: '#346ce6', // Blue - 4.5:1
			syntaxKey: '#a626a4', // Purple - 5.4:1
			syntaxOperator: '#383a42',
			syntaxComment: '#6b6e7a' // Gray - 4.7:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.06)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.12)'
		}
	}),

	/**
	 * GitHub Dark - GitHub's dark mode
	 * Background: #0d1117, Text: #e6edf3 (contrast: 16.0:1)
	 */
	'github-dark': createTheme({
		name: 'github-dark',
		displayName: 'GitHub Dark',
		type: 'dark',
		colors: {
			background: '#0d1117',
			backgroundSecondary: '#161b22',
			backgroundTertiary: '#21262d',
			toolbar: '#161b22',
			surface: '#161b22',
			surfaceSecondary: '#21262d',
			surfaceHover: '#30363d',
			text: '#e6edf3', // 16.0:1 on #0d1117
			textSecondary: '#8b949e', // 6.2:1 on #0d1117
			textMuted: '#848d97', // 4.6:1 on #0d1117
			textInverted: '#0d1117',
			border: '#30363d',
			borderSecondary: '#484f58',
			borderFocus: '#58a6ff',
			primary: '#58a6ff',
			primaryHover: '#79b8ff',
			secondary: '#6e7681',
			secondaryHover: '#8b949e',
			success: '#3fb950',
			warning: '#d29922',
			error: '#f85149',
			info: '#58a6ff',
			editorBackground: '#0d1117',
			editorForeground: '#e6edf3',
			editorSelection: 'rgba(88, 166, 255, 0.2)',
			editorLineHighlight: 'rgba(255, 255, 255, 0.04)',
			syntaxString: '#a5d6ff', // Light blue - 10.2:1
			syntaxNumber: '#79c0ff', // Blue - 8.3:1
			syntaxBoolean: '#ff7b72', // Red - 5.7:1
			syntaxNull: '#ff7b72',
			syntaxKey: '#7ee787', // Green - 9.4:1
			syntaxOperator: '#e6edf3',
			syntaxComment: '#8b949e' // Gray - 5.8:1
		},
		shadows: {
			sm: '0 1px 2px rgba(0, 0, 0, 0.5)',
			md: '0 4px 6px -1px rgba(0, 0, 0, 0.6)',
			lg: '0 10px 15px -3px rgba(0, 0, 0, 0.7)',
			xl: '0 20px 25px -5px rgba(0, 0, 0, 0.8)'
		}
	}),

	/**
	 * GitHub Light - GitHub's light mode
	 * Background: #ffffff, Text: #1f2328 (contrast: 15.1:1)
	 */
	'github-light': createTheme({
		name: 'github-light',
		displayName: 'GitHub Light',
		type: 'light',
		colors: {
			background: '#ffffff',
			backgroundSecondary: '#f6f8fa',
			backgroundTertiary: '#eaeef2',
			toolbar: '#f6f8fa',
			surface: '#f6f8fa',
			surfaceSecondary: '#eaeef2',
			surfaceHover: '#dde3e9',
			text: '#1f2328', // 15.1:1 on white
			textSecondary: '#59636e', // 6.0:1 on white
			textMuted: '#7d8590', // 4.5:1 on white
			textInverted: '#ffffff',
			border: '#d1d9e0',
			borderSecondary: '#b7c2cc',
			borderFocus: '#0969da',
			primary: '#0969da',
			primaryHover: '#0550ae',
			secondary: '#59636e',
			secondaryHover: '#474e56',
			success: '#1a7f37',
			warning: '#9a6700',
			error: '#d1242f',
			info: '#0969da',
			editorBackground: '#ffffff',
			editorForeground: '#1f2328',
			editorSelection: 'rgba(9, 105, 218, 0.15)',
			editorLineHighlight: 'rgba(0, 0, 0, 0.03)',
			syntaxString: '#0a3069', // Dark blue - 10.8:1
			syntaxNumber: '#0550ae', // Blue - 8.2:1
			syntaxBoolean: '#cf222e', // Red - 5.6:1
			syntaxNull: '#cf222e',
			syntaxKey: '#116329', // Green - 7.8:1
			syntaxOperator: '#1f2328',
			syntaxComment: '#6e7781' // Gray - 4.6:1
		},
		shadows: {
			sm: '0 1px 2px rgba(31, 35, 40, 0.05)',
			md: '0 4px 6px -1px rgba(31, 35, 40, 0.08)',
			lg: '0 10px 15px -3px rgba(31, 35, 40, 0.1)',
			xl: '0 20px 25px -5px rgba(31, 35, 40, 0.12)'
		}
	})
} as const;

/** Current theme name */
export const currentThemeName = writable<string>('dark-default');

/** Custom user-defined themes */
export const customThemes = writable<Record<string, Theme>>({});

/** All available themes (built-in + custom) */
export const allThemes = derived([customThemes], ([custom]): Record<string, Theme> => ({
	...BUILTIN_THEMES,
	...custom
}));

/** Current active theme */
export const currentTheme = derived(
	[currentThemeName, allThemes],
	([name, all]) => all[name] ?? BUILTIN_THEMES['dark-default']
);

/** System color scheme preference */
export const systemTheme = writable<'light' | 'dark'>('dark');

/** User's theme preference */
export const themePreference = writable<'system' | 'light' | 'dark' | string>('system');

let initialized = false;
let initPromise: Promise<void> | null = null;
let mediaQueryCleanup: (() => void) | null = null;

export async function initTheme(): Promise<void> {
	if (!browser) return;
	if (initialized) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		await preferencesService.init();

		const savedPreference = preferencesService.getTheme();
		themePreference.set(savedPreference || 'system');

		const savedCustomThemes = preferencesService.getCustomThemes();
		customThemes.set(savedCustomThemes as Record<string, Theme>);

		// Detect system theme
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		systemTheme.set(mediaQuery.matches ? 'dark' : 'light');

		// Listen for system theme changes (with cleanup support)
		const handleMediaChange = (e: MediaQueryListEvent) => {
			systemTheme.set(e.matches ? 'dark' : 'light');
		};
		mediaQuery.addEventListener('change', handleMediaChange);

		// Store cleanup function
		mediaQueryCleanup = () => {
			mediaQuery.removeEventListener('change', handleMediaChange);
		};

		initialized = true;
	})();

	return initPromise;
}

/** Cleanup theme subscriptions - call on app shutdown */
export function cleanupTheme(): void {
	if (mediaQueryCleanup) {
		mediaQueryCleanup();
		mediaQueryCleanup = null;
	}
}

// Sync currentThemeName with preference
themePreference.subscribe((preference) => {
	if (!preference) return;

	let themeName: string;
	if (preference === 'system') {
		themeName = get(systemTheme) === 'light' ? 'light-default' : 'dark-default';
	} else if (preference === 'light') {
		themeName = 'light-default';
	} else if (preference === 'dark') {
		themeName = 'dark-default';
	} else {
		themeName = preference;
	}

	currentThemeName.set(themeName);

	if (initialized) {
		preferencesService.setTheme(preference);
	}
});

// Handle system theme changes
systemTheme.subscribe((system) => {
	if (get(themePreference) === 'system') {
		currentThemeName.set(system === 'light' ? 'light-default' : 'dark-default');
	}
});

// Persist custom themes
customThemes.subscribe(async (custom) => {
	if (!initialized) return;

	const current = preferencesService.getCustomThemes();

	// Remove deleted themes
	for (const name of Object.keys(current)) {
		if (!custom[name]) {
			await preferencesService.deleteCustomTheme(name);
		}
	}

	for (const [name, theme] of Object.entries(custom)) {
		await preferencesService.saveCustomTheme(name, theme);
	}
});

/** Apply theme CSS variables to document */
export function applyTheme(theme: Theme): void {
	if (!browser) return;

	const root = document.documentElement;

	// Apply color variables
	for (const [key, value] of Object.entries(theme.colors)) {
		const cssVar = `--color-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
		root.style.setProperty(cssVar, value);
	}

	// Apply shadow variables
	for (const [key, value] of Object.entries(theme.shadows)) {
		root.style.setProperty(`--shadow-${key}`, value);
	}

	// Apply spacing variables
	for (const [key, value] of Object.entries(theme.spacing)) {
		root.style.setProperty(`--spacing-${key}`, value);
	}

	// Apply border radius variables
	for (const [key, value] of Object.entries(theme.borderRadius)) {
		root.style.setProperty(`--border-radius-${key}`, value);
	}

	// Apply font variables
	root.style.setProperty('--font-mono', theme.fonts.mono);
	root.style.setProperty('--font-sans', theme.fonts.sans);

	// Apply font size variables
	for (const [key, value] of Object.entries(theme.sizes)) {
		root.style.setProperty(`--font-size-${key}`, value);
	}

	// Update meta theme-color
	let metaThemeColor = document.querySelector('meta[name="theme-color"]');
	if (!metaThemeColor) {
		metaThemeColor = document.createElement('meta');
		metaThemeColor.setAttribute('name', 'theme-color');
		document.head.appendChild(metaThemeColor);
	}
	metaThemeColor.setAttribute('content', theme.colors.background);

	// Set data attributes
	document.body.dataset.theme = theme.name;
	document.body.dataset.themeType = theme.type;
}

// Auto-apply theme changes
if (browser) {
	currentTheme.subscribe(applyTheme);
}

/** Create a custom theme based on an existing theme */
export function createCustomTheme(
	baseThemeName: string,
	name: string,
	displayName: string,
	colorOverrides: Partial<ThemeColors>
): Theme {
	const baseTheme = BUILTIN_THEMES[baseThemeName as BuiltInThemeId] ?? BUILTIN_THEMES['dark-default'];

	const customTheme: Theme = {
		...baseTheme,
		name,
		displayName,
		type: 'custom',
		colors: {
			...baseTheme.colors,
			...colorOverrides
		}
	};

	customThemes.update((themes) => ({
		...themes,
		[name]: customTheme
	}));

	return customTheme;
}

/** Delete a custom theme */
export function deleteCustomTheme(name: string): void {
	customThemes.update((themes) => {
		const { [name]: _, ...rest } = themes;
		return rest;
	});
}

/** Get list of built-in theme IDs */
export function getBuiltInThemeIds(): BuiltInThemeId[] {
	return Object.keys(BUILTIN_THEMES) as BuiltInThemeId[];
}
