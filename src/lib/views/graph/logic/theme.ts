export interface GraphTheme {
	bg: string;
	bgElev: string;
	bgElev2: string;
	bgElev3: string;
	rule: string;
	rule2: string;
	text: string;
	textDim: string;
	textFaint: string;
	textGhost: string;
	accent: string;
	accent2: string;
	syntaxString: string;
	syntaxNumber: string;
	syntaxBoolean: string;
	syntaxNull: string;
	syntaxPunct: string;
	
	monoFamily: string;
	
	isLight: boolean;
}

export function mixHex(a: string, b: string, t: number): string {
	const ar = parseInt(a.slice(1, 3), 16);
	const ag = parseInt(a.slice(3, 5), 16);
	const ab = parseInt(a.slice(5, 7), 16);
	const br = parseInt(b.slice(1, 3), 16);
	const bg = parseInt(b.slice(3, 5), 16);
	const bb = parseInt(b.slice(5, 7), 16);
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg - ag) * t);
	const bl = Math.round(ab + (bb - ab) * t);
	return '#' + [r, g, bl].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function v(cs: CSSStyleDeclaration, name: string, fallback: string): string {
	const raw = cs.getPropertyValue(name).trim();
	return raw || fallback;
}

function luminance(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readGraphTheme(): GraphTheme {
	const cs = getComputedStyle(document.documentElement);
	let monoFamily = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
	try {
		const probe = document.createElement('span');
		probe.style.fontFamily = 'var(--font-mono)';
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).fontFamily;
		document.body.removeChild(probe);
		if (resolved) monoFamily = resolved;
	} catch {
		
	}
	const bg = v(cs, '--bg', '#1b1b1d');
	const bgElev = v(cs, '--bg-elev', '#212124');
	return {
		bg,
		bgElev,
		bgElev2: v(cs, '--bg-elev-2', '#27272a'),
		bgElev3: v(cs, '--bg-elev-3', '#2f2f33'),
		rule: v(cs, '--rule', '#2c2c30'),
		rule2: v(cs, '--rule-2', '#3a3a3f'),
		text: v(cs, '--text', '#e6e6e9'),
		textDim: v(cs, '--text-dim', '#9b9ba2'),
		textFaint: v(cs, '--text-faint', '#5c5c64'),
		textGhost: v(cs, '--text-ghost', '#3a3a40'),
		accent: v(cs, '--accent', '#ff6a3a'),
		accent2: v(cs, '--accent-2', '#e0a53c'),
		syntaxString: v(cs, '--syntax-string', '#e0a53c'),
		syntaxNumber: v(cs, '--syntax-number', '#7fb069'),
		syntaxBoolean: v(cs, '--syntax-boolean', '#9c6bff'),
		syntaxNull: v(cs, '--syntax-null', '#6a6a72'),
		syntaxPunct: v(cs, '--syntax-punct', '#6a6a72'),
		monoFamily,
		isLight: luminance(bg) >= 0.6,
	};
}

export function hueColor(theme: GraphTheme, hue: number): string {
	switch (hue % 4) {
		case 0:
			return theme.syntaxBoolean;
		case 1:
			return theme.syntaxNumber;
		case 2:
			return theme.accent2;
		default:
			return theme.accent;
	}
}
