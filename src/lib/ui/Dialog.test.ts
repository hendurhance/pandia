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

	it('stays open when a menu inside it already handled Escape', async () => {
		const { onClose, input } = renderDialog();
		const handled = (e: KeyboardEvent) => e.preventDefault();
		document.addEventListener('keydown', handled);
		try {
			await fireEvent.keyDown(input, { key: 'Escape' });
		} finally {
			document.removeEventListener('keydown', handled);
		}
		expect(onClose).not.toHaveBeenCalled();
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

	it.each([
		['Tab', false],
		['Shift+Tab', true],
	])('keeps %s focus inside the dialog', async (_, shiftKey) => {
		const TABBABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
		const pressTab = async () => {
			const from = document.activeElement as HTMLElement;
			if (!(await fireEvent.keyDown(from, { key: 'Tab', shiftKey }))) return;
			const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)];
			all[all.indexOf(from) + (shiftKey ? -1 : 1)]?.focus();
		};
		const before = document.createElement('button');
		const after = document.createElement('button');
		document.body.prepend(before);
		const children = createRawSnippet(() => ({
			render: () => '<div><input /><button>OK</button></div>',
		}));
		const { container, unmount } = render(Dialog, { props: { onClose: vi.fn(), children } });
		document.body.append(after);
		const first = container.querySelector('input')!;
		const last = container.querySelector('button')!;
		try {
			(shiftKey ? first : last).focus();
			await pressTab();
			expect(document.activeElement).toBe(shiftKey ? last : first);
		} finally {
			unmount();
			before.remove();
			after.remove();
		}
	});
});
