// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import NativeContextMenu from './NativeContextMenu.svelte';
import { dismissable } from './dismissable';

vi.mock('$lib/util/flags', () => ({ BLOCK_CONTEXT_MENU: true }));

// jsdom has no layout and no isContentEditable; CodeMirror and the menu read both.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
	get(this: HTMLElement) {
		return this.closest('[contenteditable="true"]') !== null;
	},
});

const clipboard = vi.hoisted(() => ({
	readText: vi.fn(async () => 'X'),
	writeText: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => clipboard);

let view: EditorView;

beforeEach(() => {
	render(NativeContextMenu);
	view = new EditorView({ doc: '{"a": 1}', parent: document.body });
});

afterEach(() => {
	cleanup();
	view.destroy();
	document.body.replaceChildren();
	vi.clearAllMocks();
});

function rightClickCode(anchor: number, head = anchor) {
	view.dispatch({ selection: { anchor, head } });
	return fireEvent.contextMenu(view.contentDOM.querySelector('.cm-line')!);
}

describe('NativeContextMenu — in the code editor', () => {
	it('pastes at the cursor', async () => {
		await rightClickCode(6);
		await fireEvent.click(screen.getByText('Paste'));
		await vi.waitFor(() => expect(view.state.doc.toString()).toBe('{"a": X1}'));
	});

	it('cuts the selection', async () => {
		await rightClickCode(6, 7);
		await fireEvent.click(screen.getByText('Cut'));
		await vi.waitFor(() => expect(view.state.doc.toString()).toBe('{"a": }'));
		expect(clipboard.writeText).toHaveBeenCalledWith('1');
	});

	it('copies the selection', async () => {
		await rightClickCode(1, 4);
		await fireEvent.click(screen.getByText('Copy'));
		await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('"a"'));
	});

	it('selects the whole document', async () => {
		await rightClickCode(0);
		await fireEvent.click(screen.getByText('Select All'));
		expect(view.state.selection.main).toMatchObject({ from: 0, to: view.state.doc.length });
	});
});

describe('NativeContextMenu — in a popover', () => {
	it('pastes into a field without closing the popover', async () => {
		const popover = document.createElement('div');
		const input = document.createElement('input');
		popover.append(input);
		document.body.append(popover);
		const onDismiss = vi.fn();
		const action = dismissable(popover, { onDismiss });
		await new Promise((r) => setTimeout(r));

		await fireEvent.contextMenu(input);
		const paste = screen.getByText('Paste');
		await fireEvent.mouseDown(paste);
		await fireEvent.click(paste);

		expect(onDismiss).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(input.value).toBe('X'));
		action.destroy();
	});

	it('pastes into a number field and reports the change', async () => {
		clipboard.readText.mockResolvedValueOnce('42');
		const input = document.createElement('input');
		input.type = 'number';
		const onInput = vi.fn();
		input.addEventListener('input', onInput);
		document.body.append(input);

		await fireEvent.contextMenu(input);
		await fireEvent.click(screen.getByText('Paste'));

		await vi.waitFor(() => expect(onInput).toHaveBeenCalled());
		expect(input.value).toBe('42');
	});
});

describe('NativeContextMenu — focus', () => {
	it('does not take focus from the field it edits when pressed', async () => {
		const input = document.createElement('input');
		document.body.append(input);
		await fireEvent.contextMenu(input);
		const notCancelled = await fireEvent.mouseDown(screen.getByText('Paste'));
		expect(notCancelled).toBe(false);
	});
});
