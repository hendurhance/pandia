// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import CodeView, { type CodeViewApi } from './CodeView.svelte';

// jsdom has no layout, and CodeMirror measures text ranges after each change.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docCanonicalText: vi.fn(async () => '{"a": 0}'),
		docCanonicalOffsets: vi.fn(async () => []),
	},
}));

describe('CodeView — committing the buffer', () => {
	it('stays dirty when you type while a commit is still being applied', async () => {
		let finishCommit!: (ok: boolean) => void;
		const onCommit = vi.fn(() => new Promise<boolean>((r) => (finishCommit = r)));
		const dirty: boolean[] = [];
		let api: CodeViewApi | null = null;
		const { container } = render(CodeView, {
			props: {
				handle: 'h' as never,
				sourceSize: 10,
				editable: true,
				onCommit,
				onDirtyChange: (d: boolean) => dirty.push(d),
				onReady: (a: CodeViewApi | null) => (api = a),
			},
		});
		await vi.waitFor(() => expect(api).not.toBeNull());
		const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
		const type = (text: string) =>
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

		type('{"a": 1}');
		const flushed = api!.flush();
		type('{"a": 2}');
		finishCommit(true);

		expect(await flushed).toBe(true);
		expect(onCommit).toHaveBeenCalledWith('{"a": 1}');
		expect(dirty.at(-1)).toBe(true);
	});
});
