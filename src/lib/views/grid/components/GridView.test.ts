// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { ipc } from '$lib/ipc/client';
import { asLosslessText } from '$lib/ipc/wire';
import type { ColumnSchema } from '$lib/ipc/bindings';
import GridView from './GridView.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docGetRows: vi.fn(async (_h: unknown, _p: unknown, start: number, end: number) =>
			Array.from({ length: end - start }, () => asLosslessText('{"a": 1}')),
		),
		docGetRowsFiltered: vi.fn(async (_h: unknown, _p: unknown, start: number, end: number) => ({
			rows: Array.from({ length: end - start }, (_, k) => ({
				index: start + k,
				value: asLosslessText('{"a": 1}'),
			})),
			total: 1000,
		})),
		docColumnValues: vi.fn(async () => ({ values: [], capped: false })),
		docScanColumns: vi.fn(async () => []),
		cancelJob: vi.fn(async () => true),
	},
}));

globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const VIEWPORT = 600;
// jsdom has no layout; give every element the grid's viewport height.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
	configurable: true,
	get: () => VIEWPORT,
});

// WebKit and Blink store layout sizes as an int32 count of 1/64 px (LayoutUnit),
// so a taller element is clamped and the rows past it can't be scrolled to.
const LAYOUT_MAX_PX = Math.floor(0x7fffffff / 64);

function schema(rowCount: number): ColumnSchema {
	return {
		gridSuitable: true,
		reason: null,
		rowCount,
		sampled: 0,
		columns: [
			{ key: 'a', kinds: ['number'], dominantKind: 'number', presence: null, nullable: false },
		],
	};
}

afterEach(() => cleanup());

describe('GridView scrolling', () => {
	it.each([100, 2_000_000])(
		'scrolls to the last of %i rows within the layout limit',
		async (rowCount) => {
			const { container } = render(GridView, {
				props: { handle: 'doc', path: [], schema: schema(rowCount) },
			});
			const scroller = container.querySelector<HTMLElement>('.scroller')!;
			const content = container.querySelector<HTMLElement>('.content')!;
			const height = parseFloat(content.style.height);
			expect(height).toBeLessThanOrEqual(LAYOUT_MAX_PX);

			scroller.scrollTop = height - VIEWPORT;
			scroller.dispatchEvent(new Event('scroll'));
			flushSync();

			const lastIndex = () => container.querySelector<HTMLElement>('.index-cell:last-child');
			await vi.waitFor(() => expect(lastIndex()?.textContent).toBe(String(rowCount - 1)));
			const lastRow = [...content.querySelectorAll<HTMLElement>('.row')].at(-1)!;
			expect(parseFloat(lastRow.style.top) + parseFloat(lastRow.style.height)).toBeCloseTo(height);
			expect(lastIndex()!.style.top).toBe(lastRow.style.top);
		},
	);
});

describe('GridView filters', () => {
	it('adding an empty OR group keeps the scroll position, selection and loaded rows', async () => {
		const { container } = render(GridView, {
			props: { handle: 'doc', path: [], schema: schema(1000) },
		});
		const screen = within(container);
		await fireEvent.click(screen.getByLabelText('Filter a'));
		await fireEvent.input(within(document.body).getByLabelText('minimum'), {
			target: { value: '0' },
		});
		await vi.waitFor(() => expect(ipc.docGetRowsFiltered).toHaveBeenCalled());

		const scroller = container.querySelector<HTMLElement>('.scroller')!;
		scroller.scrollTop = 4800;
		scroller.dispatchEvent(new Event('scroll'));
		flushSync();
		const cell = await vi.waitFor(() => {
			const el = container.querySelector<HTMLElement>('.row:nth-child(5) .cell');
			expect(el?.textContent).toBe('1');
			return el!;
		});
		await fireEvent.click(cell);
		const fetches = vi.mocked(ipc.docGetRowsFiltered).mock.calls.length;

		await fireEvent.click(screen.getByRole('button', { name: '+ OR' }));

		expect(scroller.scrollTop).toBe(4800);
		expect(container.querySelector('.cell.selected')).not.toBeNull();
		expect(ipc.docGetRowsFiltered).toHaveBeenCalledTimes(fetches);
	});
});

describe('GridView value list', () => {
	it('lists a text "1" apart from the numbers 1 and 1.0, and leaves other text unquoted', async () => {
		vi.mocked(ipc.docColumnValues).mockResolvedValueOnce({
			values: [
				{ value: asLosslessText('1'), count: 3 },
				{ value: asLosslessText('1.0'), count: 2 },
				{ value: asLosslessText('"1"'), count: 4 },
				{ value: asLosslessText('"x"'), count: 1 },
			],
			capped: false,
		});
		const mixed: ColumnSchema = {
			...schema(10),
			columns: [
				{
					key: 'b',
					kinds: ['string', 'number'],
					dominantKind: 'string',
					presence: null,
					nullable: false,
				},
			],
		};
		const { container } = render(GridView, { props: { handle: 'doc', path: [], schema: mixed } });
		await fireEvent.click(within(container).getByLabelText('Filter b'));

		const labels = await vi.waitFor(() => {
			const els = document.querySelectorAll('.cf-val');
			expect(els).toHaveLength(4);
			return [...els].map((el) => el.textContent);
		});
		expect(labels).toEqual(['1', '1.0', '"1"', 'x']);
	});
});

describe('GridView columns', () => {
	it('adds a column that only rows outside the sample have, and stops the scan on close', async () => {
		let finishScan!: (cols: ColumnSchema['columns']) => void;
		vi.mocked(ipc.docScanColumns).mockReturnValueOnce(new Promise((r) => (finishScan = r)));
		const sampled: ColumnSchema = { ...schema(2000), sampled: 1000 };
		const { container, unmount } = render(GridView, {
			props: { handle: 'doc', path: [], schema: sampled },
		});
		const scroller = container.querySelector<HTMLElement>('.scroller')!;
		scroller.scrollTop = 4800;
		scroller.dispatchEvent(new Event('scroll'));
		flushSync();

		finishScan([
			{ key: 'a', kinds: ['number'], dominantKind: 'number', presence: 1, nullable: false },
			{ key: 'late', kinds: ['string'], dominantKind: 'string', presence: 0.001, nullable: false },
		]);
		await within(container).findByLabelText('Filter late');
		expect(scroller.scrollTop).toBe(4800);
		expect(within(container).getAllByLabelText(/^Filter /)).toHaveLength(2);
		const jobId = vi.mocked(ipc.docScanColumns).mock.calls[0]?.[2];
		unmount();
		expect(ipc.cancelJob).toHaveBeenCalledWith(jobId);
	});
});

describe('GridView editing', () => {
	const cell = (c: HTMLElement, row: number) =>
		c.querySelector<HTMLElement>(`[data-cell-row="${row}"][data-cell-col="a"]`);

	it('edits a cell in place, then keeps the scroll and moves down after the refresh', async () => {
		const onApply = vi.fn(async () => true);
		const { container, rerender } = render(GridView, {
			props: { handle: 'doc', path: ['rows'], schema: schema(100), onApply },
		});
		const scroller = container.querySelector<HTMLElement>('.scroller')!;
		scroller.scrollTop = 240;
		scroller.dispatchEvent(new Event('scroll'));
		flushSync();
		await vi.waitFor(() => expect(cell(container, 12)?.textContent).toBe('1'));

		await fireEvent.dblClick(cell(container, 12)!);
		const input = container.querySelector<HTMLInputElement>('.cell-editor')!;
		expect(input.value).toBe('1');
		await fireEvent.input(input, { target: { value: '2' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(onApply).toHaveBeenCalledWith({
			kind: 'setValueText',
			path: ['rows', 12, 'a'],
			text: '2',
		});
		await rerender({ handle: 'doc', path: ['rows'], schema: schema(100), onApply });
		await vi.waitFor(() => expect(cell(container, 13)?.classList.contains('selected')).toBe(true));
		expect(scroller.scrollTop).toBe(240);
		expect(container.querySelector('.cell-editor')).toBeNull();
	});

	it('follows the edited row to its new place after the rows re-order', async () => {
		const onApply = vi.fn(async () => true);
		const { container, rerender } = render(GridView, {
			props: { handle: 'doc', path: [], schema: schema(20), onApply },
		});
		const screen = within(container);
		await fireEvent.click(screen.getByLabelText('Filter a'));
		await fireEvent.input(within(document.body).getByLabelText('minimum'), {
			target: { value: '0' },
		});
		await vi.waitFor(() => expect(ipc.docGetRowsFiltered).toHaveBeenCalled());
		await vi.waitFor(() => expect(cell(container, 5)?.textContent).toBe('1'));

		await fireEvent.dblClick(cell(container, 5)!);
		const input = container.querySelector<HTMLInputElement>('.cell-editor')!;
		await fireEvent.input(input, { target: { value: '2' } });
		vi.mocked(ipc.docGetRowsFiltered).mockImplementation(
			async (_h: unknown, _p: unknown, start: number, end: number) => ({
				rows: Array.from({ length: end - start }, (_, k) => {
					const pos = start + k;
					const index = pos === 15 ? 5 : pos >= 5 && pos < 15 ? pos + 1 : pos;
					return { index, value: asLosslessText('{"a": 1}') };
				}),
				total: 20,
			}),
		);
		await fireEvent.keyDown(input, { key: 'Tab' });
		expect(onApply).toHaveBeenCalledWith({ kind: 'setValueText', path: [5, 'a'], text: '2' });

		await rerender({ handle: 'doc', path: [], schema: schema(20), onApply });
		await vi.waitFor(() => expect(cell(container, 15)?.classList.contains('selected')).toBe(true));
	});

	it('Esc leaves the cell unchanged, and invalid input stays in the editor', async () => {
		const onApply = vi.fn(async () => true);
		const onError = vi.fn();
		const { container } = render(GridView, {
			props: { handle: 'doc', path: [], schema: schema(10), onApply, onError },
		});
		await vi.waitFor(() => expect(cell(container, 0)?.textContent).toBe('1'));

		await fireEvent.keyDown(cell(container, 0)!, { key: 'Enter' });
		let input = container.querySelector<HTMLInputElement>('.cell-editor')!;
		await fireEvent.input(input, { target: { value: '9' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(container.querySelector('.cell-editor')).toBeNull();

		await fireEvent.keyDown(cell(container, 0)!, { key: 'F2' });
		input = container.querySelector<HTMLInputElement>('.cell-editor')!;
		await fireEvent.input(input, { target: { value: 'abc' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(container.querySelector<HTMLInputElement>('.cell-editor')?.value).toBe('abc');
		expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('invalid number'));
		expect(onApply).not.toHaveBeenCalled();
	});
});
