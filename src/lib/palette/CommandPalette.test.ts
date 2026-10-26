// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import CommandPalette from './CommandPalette.svelte';

function renderPalette() {
	const onClose = vi.fn();
	const { container, rerender } = render(CommandPalette, { props: { open: true, onClose } });
	return {
		onClose,
		rerender,
		input: container.querySelector('input')!,
		backdrop: container.querySelector('.backdrop')!,
	};
}

describe('CommandPalette — closing on the backdrop', () => {
	it('stays open when a text selection is dragged out and released on the backdrop', async () => {
		const { onClose, input, backdrop } = renderPalette();
		await fireEvent.mouseDown(input);
		await fireEvent.click(backdrop);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('closes when the backdrop is clicked', async () => {
		const { onClose, backdrop } = renderPalette();
		await fireEvent.mouseDown(backdrop);
		await fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('CommandPalette — focus', () => {
	it('gives focus back to what had it when closed without running a command', async () => {
		const trigger = document.createElement('button');
		document.body.append(trigger);
		trigger.focus();
		const { input, rerender } = renderPalette();
		input.focus();
		await rerender({ open: false });
		expect(document.activeElement).toBe(trigger);
	});
});
