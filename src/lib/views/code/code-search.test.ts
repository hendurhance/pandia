// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import CodeView, { type CodeViewApi } from './CodeView.svelte';

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const TEXT = '{\n  "a": "x\\ny"\n}';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docCanonicalText: vi.fn(async () => TEXT),
		docCanonicalOffsets: vi.fn(async () => []),
	},
}));

async function mount() {
	let api: CodeViewApi | null = null;
	const { container } = render(CodeView, {
		props: {
			handle: 'h' as never,
			sourceSize: TEXT.length,
			editable: true,
			onReady: (a: CodeViewApi | null) => (api = a),
		},
	});
	await vi.waitFor(() => expect(api).not.toBeNull());
	const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
	return { api: api!, view };
}

describe('Code view find & replace treats the query as a plain substring', () => {
	it('replace-all of the text \\n replaces that substring, not the line breaks', async () => {
		const { api, view } = await mount();
		const n = api.cmReplaceAll('\\n', 'Z', false);
		expect(n).toBe(1);
		expect(view.state.doc.toString()).toBe('{\n  "a": "xZy"\n}');
	});

	it('find next lands on the counted substring', async () => {
		const { api, view } = await mount();
		const count = api.cmSearch('\\n', false);
		expect(count).toBe(1);
		const sel = view.state.selection.main;
		expect(view.state.sliceDoc(sel.from, sel.to)).toBe('\\n');
	});
});
