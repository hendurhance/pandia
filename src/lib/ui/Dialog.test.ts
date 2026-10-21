// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { fireEvent, render } from '@testing-library/svelte';
import Dialog from './Dialog.svelte';

function renderDialog() {
	const onClose = vi.fn();
	const children = createRawSnippet(() => ({ render: () => '<div><input /></div>' }));
	const { container, unmount } = render(Dialog, { props: { onClose, children } });
	return {
		onClose,
		unmount,
		input: container.querySelector('input')!,
		scrim: container.querySelector('.scrim')!,
	};
}

describe('Dialog — closing on the scrim', () => {
	it('stays open when a text selection is dragged out and released on the scrim', async () => {
		const { onClose, input, scrim } = renderDialog();
		await fireEvent.mouseDown(input);
		await fireEvent.click(scrim);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('closes when the scrim is clicked', async () => {
		const { onClose, scrim } = renderDialog();
		await fireEvent.mouseDown(scrim);
		await fireEvent.click(scrim);
		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('Dialog — keyboard and focus', () => {
	it('closes only the top dialog on Escape when two are stacked', async () => {
		const below = renderDialog();
		const top = renderDialog();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(top.onClose).toHaveBeenCalledOnce();
		expect(below.onClose).not.toHaveBeenCalled();
	});

	it('gives focus back to what had it before it opened', () => {
		const trigger = document.createElement('button');
		document.body.append(trigger);
		trigger.focus();
		const { input, unmount } = renderDialog();
		input.focus();
		unmount();
		expect(document.activeElement).toBe(trigger);
	});
});
