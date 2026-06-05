import { loadPersisted, savePersisted, SETTINGS_FILE } from '$lib/util/persist';
import { PersistedStore } from '$lib/util/persisted-store.svelte';
import { oneOf } from '$lib/util/guards';
import {
	applyDensity,
	applyFontFamily,
	applyFontSizeBase,
	applyTheme,
	resetAppearance,
	THEMES,
	DEFAULT_THEME,
	familyOf,
	type Density,
} from '$lib/shell/logic/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const STORE_KEY = 'appearance';

const DEFAULT_THEME_ID = DEFAULT_THEME.id;
const DEFAULT_MONO = 'IBM Plex Mono';
const DEFAULT_FONT_SIZE = 12.5;
const DEFAULT_DENSITY: Density = 'normal';

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 18;

interface Persisted {
	themeId: string;
	autoMode: boolean; // follow the OS dark/light preference (using themeId's family)
	fontFamily: string;
	fontSizeBase: number;
	density: Density;
}

const VALID_DENSITY: Density[] = ['compact', 'normal', 'comfortable'];

function sanitize(raw: unknown): Persisted {
	const fallback: Persisted = {
		themeId: DEFAULT_THEME_ID,
		autoMode: false,
		fontFamily: DEFAULT_MONO,
		fontSizeBase: DEFAULT_FONT_SIZE,
		density: DEFAULT_DENSITY,
	};
	if (typeof raw !== 'object' || raw === null) return fallback;
	const r = raw as Record<string, unknown>;
	return {
		themeId: typeof r.themeId === 'string' && r.themeId in THEMES ? r.themeId : DEFAULT_THEME_ID,
		autoMode: typeof r.autoMode === 'boolean' ? r.autoMode : false,
		fontFamily:
			typeof r.fontFamily === 'string' && r.fontFamily.trim() ? r.fontFamily.trim() : DEFAULT_MONO,
		fontSizeBase:
			typeof r.fontSizeBase === 'number' && Number.isFinite(r.fontSizeBase)
				? Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, r.fontSizeBase))
				: DEFAULT_FONT_SIZE,
		density: oneOf(r.density, VALID_DENSITY) ? r.density : DEFAULT_DENSITY,
	};
}

class AppearancePrefs extends PersistedStore {
	themeId: string = $state(DEFAULT_THEME_ID);
	autoMode: boolean = $state(false);
	
	systemPrefersDark: boolean = $state(true);
	fontFamily: string = $state(DEFAULT_MONO);
	fontSizeBase: number = $state(DEFAULT_FONT_SIZE);
	density: Density = $state(DEFAULT_DENSITY);

	private mediaBound = false;

	protected async load(): Promise<void> {
		try {
			const raw = await loadPersisted<Persisted>(SETTINGS_FILE, STORE_KEY);
			const p = sanitize(raw);
			this.themeId = p.themeId;
			this.autoMode = p.autoMode;
			this.fontFamily = p.fontFamily;
			this.fontSizeBase = p.fontSizeBase;
			this.density = p.density;
		} catch {
			
		}
	}

	protected onReady(): void {
		this.bindSystemTheme();
		this.applyAll();
	}

	private bindSystemTheme(): void {
		if (this.mediaBound || typeof window === 'undefined' || !window.matchMedia) return;
		this.mediaBound = true;
		const mq = window.matchMedia(DARK_QUERY);
		this.systemPrefersDark = mq.matches;
		mq.addEventListener('change', (e) => {
			this.systemPrefersDark = e.matches;
			if (this.autoMode) this.applyResolved();
		});
	}

	
	private resolvedId(): string {
		if (!this.autoMode) return this.themeId;
		const fam = familyOf(this.themeId);
		if (!fam?.dark || !fam.light) return this.themeId;
		return this.systemPrefersDark ? fam.dark : fam.light;
	}

	private applyResolved(): void {
		const id = this.resolvedId();
		if (id !== this.themeId) this.themeId = id;
		applyTheme(THEMES[id] ?? DEFAULT_THEME);
	}

	private applyAll(): void {
		this.applyResolved();
		applyDensity(this.density);
		if (this.fontFamily !== DEFAULT_MONO) {
			applyFontFamily({ mono: this.fontFamily });
		}
		if (this.fontSizeBase !== DEFAULT_FONT_SIZE) {
			applyFontSizeBase(this.fontSizeBase);
		}
	}

	private async persist(): Promise<void> {
		await savePersisted(SETTINGS_FILE, STORE_KEY, {
			themeId: this.themeId,
			autoMode: this.autoMode,
			fontFamily: this.fontFamily,
			fontSizeBase: this.fontSizeBase,
			density: this.density,
		} satisfies Persisted);
	}

	
	async setTheme(id: string): Promise<void> {
		if (!(id in THEMES)) return;
		if (!this.autoMode && this.themeId === id) return;
		this.autoMode = false;
		this.themeId = id;
		applyTheme(THEMES[id]);
		await this.persist();
	}

	
	async setAuto(idInFamily: string): Promise<void> {
		const fam = familyOf(idInFamily);
		if (!fam?.dark || !fam.light) return;
		this.autoMode = true;
		this.themeId = idInFamily;
		this.applyResolved();
		await this.persist();
	}

	async setFontFamily(family: string): Promise<void> {
		const trimmed = family.trim();
		if (!trimmed || trimmed === this.fontFamily) return;
		this.fontFamily = trimmed;
		applyFontFamily({ mono: trimmed });
		await this.persist();
	}

	async setFontSize(px: number): Promise<void> {
		const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(px * 10) / 10));
		if (clamped === this.fontSizeBase) return;
		this.fontSizeBase = clamped;
		applyFontSizeBase(clamped);
		await this.persist();
	}

	async setDensity(d: Density): Promise<void> {
		if (this.density === d) return;
		this.density = d;
		applyDensity(d);
		await this.persist();
	}

	async reset(): Promise<void> {
		this.themeId = DEFAULT_THEME_ID;
		this.autoMode = false;
		this.fontFamily = DEFAULT_MONO;
		this.fontSizeBase = DEFAULT_FONT_SIZE;
		this.density = DEFAULT_DENSITY;
		resetAppearance();
		await this.persist();
	}
}

export const appearancePrefs = new AppearancePrefs();
