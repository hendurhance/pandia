// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ExportDialog from './ExportDialog.svelte';

vi.mock('$lib/ipc/client', async () => ({
	ipc: (await import('$lib/ipc/fake')).fakeIpc({
		docExportPreview: vi.fn(async () => ({ text: '{}', truncated: false })),
	}),
}));

function formatButton(container: HTMLElement, label: string) {
	return [...container.querySelectorAll<HTMLButtonElement>('.fmt')].find(
		(b) => b.textContent === label,
	)!;
}

describe('ExportDialog', () => {
	it('offers only JSON for a file too large to convert, and says why', () => {
		const { container } = render(ExportDialog, {
			props: {
				handle: 'h' as never,
				sourceName: 'big.json',
				convertible: false,
				onClose: () => {},
			},
		});
		expect(formatButton(container, 'JSON').disabled).toBe(false);
		expect(formatButton(container, 'JSON · min').disabled).toBe(false);
		for (const label of ['YAML', 'CSV', 'XML']) {
			const button = formatButton(container, label);
			expect(button.disabled).toBe(true);
			expect(button.title).toContain('export as JSON only');
		}
	});

	it('offers every format when the file can be converted', () => {
		const { container } = render(ExportDialog, {
			props: {
				handle: 'h' as never,
				sourceName: 'small.json',
				convertible: true,
				onClose: () => {},
			},
		});
		expect(formatButton(container, 'CSV').disabled).toBe(false);
	});
});
