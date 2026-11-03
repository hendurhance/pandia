import { describe, it, expect } from 'vitest';
import { JSON_OPEN_FILTERS } from '$lib/util/file-types';

describe('Open dialog', () => {
	it('lets you pick the formats Pandia converts', () => {
		const pickable = JSON_OPEN_FILTERS.flatMap((f) => f.extensions as readonly string[]);
		for (const ext of ['yaml', 'yml', 'xml', 'csv']) {
			expect(pickable, `.${ext} files can't be chosen in the Open dialog`).toContain(ext);
		}
	});
});
