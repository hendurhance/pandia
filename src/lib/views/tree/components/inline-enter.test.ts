// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import InlineCellEditor from './InlineCellEditor.svelte';

function editString(buffer: string) {
	const onCommit = vi.fn();
	const { container } = render(InlineCellEditor, {
		props: {
			field: 'value',
			kind: 'string',
			buffer,
			onInput: () => {},
			onCommit,
			onCancel: () => {},
		},
	});
	return { onCommit, area: container.querySelector('textarea')!, container };
}

describe('editing a string value in the Tree', () => {
	it('commits a one-line string on ⏎', async () => {
		const { onCommit, area } = editString('Bob');
		await fireEvent.keyDown(area, { key: 'Enter' });
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it('keeps editing a multi-line string on ⏎ and commits it on ⌘⏎', async () => {
		const { onCommit, area } = editString('line 1\nline 2');
		await fireEvent.keyDown(area, { key: 'Enter' });
		expect(onCommit).not.toHaveBeenCalled();
		await fireEvent.keyDown(area, { key: 'Enter', metaKey: true });
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it('labels the save key the string commits with', () => {
		expect(editString('Bob').container.querySelector('.commit')?.textContent).not.toMatch(/⌘|Ctrl/);
		expect(editString('a\nb').container.querySelector('.commit')?.textContent).toMatch(/⌘|Ctrl/);
	});
});
