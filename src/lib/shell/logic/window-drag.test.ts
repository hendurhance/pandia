// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const startDragging = vi.fn(async () => {});
vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({ startDragging }),
}));

import { dragWindowFrom } from './window-drag';
import SettingsView from '$lib/settings/SettingsView.svelte';

function sized(
	el: HTMLElement,
	size: Partial<
		Record<'clientHeight' | 'clientWidth' | 'offsetHeight' | 'scrollWidth' | 'scrollHeight', number>
	>,
) {
	for (const [k, v] of Object.entries(size))
		Object.defineProperty(el, k, { configurable: true, value: v });
	return el;
}

function press(target: HTMLElement, at: { offsetX?: number; offsetY?: number } = {}) {
	const e = new MouseEvent('pointerdown', { button: 0, bubbles: true }) as PointerEvent;
	Object.defineProperty(e, 'target', { value: target });
	Object.defineProperty(e, 'offsetX', { value: at.offsetX ?? 0 });
	Object.defineProperty(e, 'offsetY', { value: at.offsetY ?? 0 });
	dragWindowFrom(e);
}

beforeEach(() => startDragging.mockClear());

describe('dragging the window from a top bar', () => {
	it('drags from empty space but not from a control', () => {
		const bar = document.createElement('header');
		const button = bar.appendChild(document.createElement('button'));
		press(bar);
		expect(startDragging).toHaveBeenCalledTimes(1);
		press(button);
		expect(startDragging).toHaveBeenCalledTimes(1);
	});

	it('leaves a press on a scrollbar to the scrollbar', () => {
		const tabs = sized(document.createElement('div'), {
			clientHeight: 34,
			scrollWidth: 2000,
			clientWidth: 900,
		});
		press(tabs, { offsetY: 38 });
		expect(startDragging).not.toHaveBeenCalled();
		press(tabs, { offsetY: 20 });
		expect(startDragging).toHaveBeenCalledTimes(1);
	});

	it('leaves the bottom edge of a strip with an overlay scrollbar to the scrollbar', () => {
		const tabs = sized(document.createElement('div'), {
			clientHeight: 34,
			offsetHeight: 34,
			scrollWidth: 2000,
			clientWidth: 900,
		});
		press(tabs, { offsetY: 30 });
		expect(startDragging).not.toHaveBeenCalled();
		press(tabs, { offsetY: 12 });
		expect(startDragging).toHaveBeenCalledTimes(1);
	});

	it('works from the Settings top bar too', async () => {
		const { container } = render(SettingsView, {
			props: { active: 'appearance', onSelectTab: () => {}, onClose: () => {} },
		});
		const header = container.querySelector<HTMLElement>('header.top')!;
		header.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
		expect(startDragging).toHaveBeenCalledTimes(1);
	});
});
