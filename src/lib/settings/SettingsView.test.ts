// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Dialog from '$lib/ui/Dialog.svelte';
import SettingsView from './SettingsView.svelte';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.9') }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));

afterEach(() => cleanup());

function renderSettings() {
	const onClose = vi.fn();
	render(SettingsView, { props: { onClose, active: 'about', onSelectTab: () => {} } });
	return onClose;
}

describe('SettingsView — Escape', () => {
	it('closes when nothing is open above it', async () => {
		const onClose = renderSettings();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('leaves Escape to a dialog opened on top of it', async () => {
		const onClose = renderSettings();
		const dialogClose = vi.fn();
		const children = createRawSnippet(() => ({ render: () => '<div></div>' }));
		render(Dialog, { props: { onClose: dialogClose, children } });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(dialogClose).toHaveBeenCalledOnce();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('leaves Escape to a menu or popover that already handled it', async () => {
		const onClose = renderSettings();
		const handled = (e: KeyboardEvent) => e.preventDefault();
		document.addEventListener('keydown', handled);
		try {
			await fireEvent.keyDown(document.body, { key: 'Escape' });
		} finally {
			document.removeEventListener('keydown', handled);
		}
		expect(onClose).not.toHaveBeenCalled();
	});
});
