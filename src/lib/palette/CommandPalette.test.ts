// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { commandRegistry, type Command } from './state/command-store.svelte';
import CommandPalette from './CommandPalette.svelte';

vi.mock('$lib/util/persist', async (original) => ({
	...(await original()),
	loadPersisted: vi.fn(async () => undefined),
	savePersisted: vi.fn(async () => {}),
}));

Element.prototype.scrollIntoView = () => {};

function renderPalette() {
	const onClose = vi.fn();
	const { container, rerender } = render(CommandPalette, { props: { open: true, onClose } });
	return {
		onClose,
		rerender,
		container,
		input: container.querySelector('input')!,
		backdrop: container.querySelector('.backdrop')!,
	};
}

function withCommands(cmds: Array<Pick<Command, 'id' | 'label' | 'run'>>) {
	const dispose = cmds.map((c) => commandRegistry.register({ ...c, category: 'View' }));
	return () => dispose.forEach((d) => d());
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

	it('gives focus back to what had it after a command that does not move focus', async () => {
		const dispose = withCommands([{ id: 'test.noop', label: 'Do nothing', run: () => {} }]);
		try {
			const trigger = document.createElement('button');
			document.body.append(trigger);
			trigger.focus();
			const { input, rerender, onClose } = renderPalette();
			input.focus();
			await fireEvent.input(input, { target: { value: 'Do nothing' } });
			await fireEvent.keyDown(input, { key: 'Enter' });
			expect(onClose).toHaveBeenCalledOnce();
			await rerender({ open: false });
			expect(document.activeElement).toBe(trigger);
		} finally {
			dispose();
		}
	});

	it('leaves focus where the command put it', async () => {
		const target = document.createElement('input');
		document.body.append(target);
		const dispose = withCommands([
			{ id: 'test.focus', label: 'Focus a field', run: () => target.focus() },
		]);
		try {
			const trigger = document.createElement('button');
			document.body.append(trigger);
			trigger.focus();
			const { input, rerender } = renderPalette();
			input.focus();
			await fireEvent.input(input, { target: { value: 'Focus a field' } });
			await fireEvent.keyDown(input, { key: 'Enter' });
			await rerender({ open: false });
			expect(document.activeElement).toBe(target);
		} finally {
			dispose();
		}
	});
});

describe('CommandPalette — pointer and keyboard selection', () => {
	const rows = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label) => ({
		id: `test.${label}`,
		label,
		run: () => {},
	}));
	const selected = (container: HTMLElement) =>
		container.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim();

	it('keeps the keyboard selection when rows scroll under a resting pointer', async () => {
		const dispose = withCommands(rows);
		try {
			const { container, input } = renderPalette();
			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			expect(selected(container)).toBe('Charlie');
			const first = container.querySelector('[role="option"]')!;
			await fireEvent.mouseOver(first);
			await fireEvent.mouseEnter(first);
			expect(selected(container)).toBe('Charlie');
		} finally {
			dispose();
		}
	});

	it('selects the row under a pointer that moves, not on a move event at the same spot', async () => {
		const dispose = withCommands(rows);
		try {
			const { container, input } = renderPalette();
			const option = (label: string) =>
				[...container.querySelectorAll('[role="option"]')].find(
					(el) => el.textContent?.trim() === label,
				)!;
			await fireEvent.mouseMove(option('Bravo'), { clientX: 10, clientY: 10 });
			expect(selected(container)).toBe('Bravo');
			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			expect(selected(container)).toBe('Charlie');
			await fireEvent.mouseMove(option('Delta'), { clientX: 10, clientY: 10 });
			expect(selected(container)).toBe('Charlie');
			await fireEvent.mouseMove(option('Delta'), { clientX: 10, clientY: 40 });
			expect(selected(container)).toBe('Delta');
		} finally {
			dispose();
		}
	});
});
