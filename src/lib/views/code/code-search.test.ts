// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { ipc } from '$lib/ipc/client';
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

async function mount(text = TEXT) {
	vi.mocked(ipc.docCanonicalText).mockResolvedValueOnce(text as never);
	let api: CodeViewApi | null = null;
	const { container } = render(CodeView, {
		props: {
			handle: 'h' as never,
			sourceSize: text.length,
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
		const { count } = api.cmSearch('\\n', false);
		expect(count).toBe(1);
		const sel = view.state.selection.main;
		expect(view.state.sliceDoc(sel.from, sel.to)).toBe('\\n');
	});
});

describe('Code view find marks every match', () => {
	it('marks each match, the current one more strongly, and clears them when the query empties', async () => {
		const { api, view } = await mount();
		expect(api.cmSearch('"', false).count).toBe(4);
		await vi.waitFor(() =>
			expect(view.contentDOM.querySelectorAll('.cm-searchMatch').length).toBe(4),
		);
		expect(view.contentDOM.querySelectorAll('.cm-searchMatch-selected').length).toBe(1);

		api.cmSearch('', false);
		await vi.waitFor(() =>
			expect(view.contentDOM.querySelectorAll('.cm-searchMatch').length).toBe(0),
		);
	});
});

describe('Code view find starts at the cursor', () => {
	const FOOS = '{\n  "foo1": 1,\n  "foo2": 2,\n  "foo3": 3\n}';

	it('stays on the first match while the query grows', async () => {
		const { api, view } = await mount(FOOS);
		for (const q of ['f', 'fo', 'foo']) {
			api.cmSearch(q, false);
			expect(view.state.selection.main.from).toBe(FOOS.indexOf('foo1'));
		}
		expect(api.cmSearch('foo', false)).toEqual({ count: 3, current: 1 });
	});

	it.each([
		['before the first match', 0, 1],
		['at the second match', FOOS.indexOf('foo2'), 2],
		['inside the second match', FOOS.indexOf('foo2') + 1, 3],
		['after the last match', FOOS.length, 1],
	])(
		'from a cursor %s, selects the next match and reports its number',
		async (_, cursor, current) => {
			const { api, view } = await mount(FOOS);
			view.dispatch({ selection: { anchor: cursor } });
			const result = api.cmSearch('foo', false);
			const sel = view.state.selection.main;
			expect(view.state.sliceDoc(sel.from, sel.to + 1)).toBe(`foo${current}`);
			expect(result).toEqual({ count: 3, current });
		},
	);
});

describe('Code view Find Next and Previous report the match they select', () => {
	const DOC = '[\n  "foo",\n  1,\n  "foo",\n  2,\n  "foo"\n]';
	const starts = [...DOC.matchAll(/foo/g)].map((m) => m.index);

	it.each([
		['Next', 'the end of line 6', 1, 6],
		['Next', 'the end of line 2', 2, 2],
		['Previous', 'the end of line 4', 2, 4],
		['Previous', 'the end of line 1', 3, 1],
	] as const)('%s from %s selects match %i and reports it', async (step, _, current, line) => {
		const { api, view } = await mount(DOC);
		expect(api.cmSearch('foo', false)).toEqual({ count: 3, current: 1 });
		view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
		const result = step === 'Next' ? api.cmFindNext('foo', false) : api.cmFindPrev('foo', false);
		expect(view.state.selection.main.from).toBe(starts[current - 1]);
		expect(result).toEqual({ count: 3, current });
	});

	it('Next from inside a match selects a counted match', async () => {
		const { api, view } = await mount('[1000]');
		expect(api.cmSearch('00', false)).toEqual({ count: 1, current: 1 });
		view.dispatch({ selection: { anchor: 3 } });
		expect(api.cmFindNext('00', false)).toEqual({ count: 1, current: 1 });
		const sel = view.state.selection.main;
		expect([sel.from, sel.to]).toEqual([2, 4]);
	});
});
