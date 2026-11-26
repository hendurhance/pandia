// @vitest-environment jsdom
import { afterAll, describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { noirTheme } from './codemirror-theme';

const classCount = (selector: string) => (selector.match(/\.[^\s.>:]+/g) ?? []).length;

function focusedSelectionRules(): { selector: string; ours: boolean }[] {
	const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('');
	const out: { selector: string; ours: boolean }[] = [];
	for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		if (!/background/.test(body!)) continue;
		for (const selector of selectors!.split(',').map((s) => s.trim())) {
			if (selector.includes('cm-focused') && selector.endsWith('.cm-selectionBackground')) {
				out.push({ selector, ours: body!.includes('--accent-fill') });
			}
		}
	}
	return out;
}

const view = new EditorView({ doc: '{"a": 1}', extensions: [noirTheme], parent: document.body });
afterAll(() => view.destroy());

describe('noirTheme selection', () => {
	it("outranks CodeMirror's dark base rule for a focused editor", () => {
		const rules = focusedSelectionRules();
		const ours = rules.filter((r) => r.ours).map((r) => classCount(r.selector));
		const base = rules.filter((r) => !r.ours).map((r) => classCount(r.selector));
		expect(ours.length).toBeGreaterThan(0);
		expect(base.length).toBeGreaterThan(0);
		expect(Math.max(...ours)).toBeGreaterThanOrEqual(Math.max(...base));
	});
});
