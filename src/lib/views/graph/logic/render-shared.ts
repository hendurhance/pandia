import type { CardRow } from './layout';
import type { GraphTheme } from './theme';

export const CARD_RADIUS = 6;
export const FONT_PX = 13;
export const HEADER_FONT_WEIGHT = 600;
export const ROW_PAD_X = 11; // matches legacy .card-row padding (0.7rem ≈ 11.2px)
export const SWATCH_W = 11;
export const SWATCH_GAP = 6;

export function valueColor(row: CardRow, theme: GraphTheme): string {
	if (row.container) return theme.textDim;
	switch (row.valueKind) {
		case 'string':
			return theme.text;
		case 'number':
			return theme.syntaxNumber;
		case 'bool':
			return theme.syntaxBoolean;
		case 'null':
			return theme.syntaxNull;
		default:
			return theme.text;
	}
}
