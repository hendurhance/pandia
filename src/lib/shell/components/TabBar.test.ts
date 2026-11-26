// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { render } from '@testing-library/svelte';
import { reactiveBox } from '$lib/views/shared/test-runes.svelte';
import TabBar from './TabBar.svelte';

const scrolled: string[] = [];
Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
	scrolled.push((this as HTMLElement).dataset.tabId ?? '');
});

const tabs = Array.from({ length: 50 }, (_, i) => ({
	id: `tab-${i}`,
	label: `${i}.json`,
	sourceName: null,
}));

function props(activeTabId: string, capWarning = false) {
	return {
		tabs,
		activeTabId,
		tabStatuses: {},
		capWarning,
		maxTabs: 50,
		hasActiveDoc: true,
		canCompare: true,
		comparePickerOpen: false,
		onActivate: () => {},
		onClose: () => {},
		onNew: () => {},
		onReorder: () => {},
		onToggleCompare: () => {},
		onExport: () => {},
	};
}

describe('TabBar', () => {
	it('scrolls the newly active tab into view', async () => {
		const { rerender } = render(TabBar, { props: props('tab-0') });
		scrolled.length = 0;
		await rerender(props('tab-49'));
		expect(scrolled).toEqual(['tab-49']);
	});

	it('scrolls again when the active tab grows, once its file name replaces the placeholder', () => {
		const live = reactiveBox(
			tabs.map((t) => (t.id === 'tab-49' ? { ...t, label: 'untitled' } : t)),
		);
		const target = document.body.appendChild(document.createElement('div'));
		const bar = mount(TabBar, {
			target,
			props: {
				...props('tab-49'),
				get tabs() {
					return live.value;
				},
			},
		});
		try {
			flushSync();
			scrolled.length = 0;
			live.value = live.value.map((t) =>
				t.id === 'tab-49' ? { ...t, label: 'a-much-longer-file-name.json' } : t,
			);
			flushSync();
			expect(scrolled).toEqual(['tab-49']);
		} finally {
			unmount(bar);
		}
	});

	it('keeps the new-tab button and the cap warning outside the scrolling strip', () => {
		const { container } = render(TabBar, { props: props('tab-0', true) });
		expect(container.querySelector('.cap-warn')).not.toBeNull();
		expect(container.querySelector('.tab-scroll .cap-warn')).toBeNull();
		expect(container.querySelector('.tab-scroll .tab-new')).toBeNull();
	});
});
