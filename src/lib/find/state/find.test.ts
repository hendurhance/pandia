import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import type { SearchHit } from '$lib/ipc/bindings';
import { FindController, type FindDeps } from './find.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docSearch: vi.fn(async () => []),
		docReplace: vi.fn(async () => ({ count: 1, applied: null })),
		cancelJob: vi.fn(async () => true),
	},
}));

const hit: SearchHit = {
	path: ['foo'],
	kind: 'string',
	matchField: 'key',
	snippet: 'foo',
};

function controller(handle: string | null = null, over: Partial<FindDeps> = {}) {
	return new FindController({
		handle: () => handle,
		canOpen: () => true,
		isCodeView: () => false,
		isGraphView: () => false,
		switchToTree: () => {},
		codeApi: () => null,
		openGraphSearch: () => {},
		navigateToHit: () => {},
		afterReplace: async () => {},
		...over,
	} as FindDeps);
}

describe('FindController — find and replace', () => {
	it('Find leaves the replace field as it was', () => {
		const find = controller();
		find.openFind();
		expect(find.open).toBe(true);
		expect(find.replaceOpen).toBe(false);
	});

	it('Find and Replace opens the bar with the replace field showing', () => {
		const find = controller();
		find.openReplace();
		expect(find.open).toBe(true);
		expect(find.replaceOpen).toBe(true);
	});
});

describe('FindController — the typing debounce', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		['closing the bar', (find: FindController) => find.close()],
		['switching document', (find: FindController) => find.reset()],
	])('%s before the debounce ends cancels the search', async (_, stop) => {
		vi.useFakeTimers();
		try {
			const find = controller('h');
			find.openFind();
			find.onQueryChange('name');
			stop(find);
			await vi.runAllTimersAsync();
			expect(ipc.docSearch).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('FindController — closing in the Code view', () => {
	it('clears the code search, so its match marks go away', () => {
		const cmSearch = vi.fn(() => 0);
		const find = new FindController({
			handle: () => 'h',
			canOpen: () => true,
			isCodeView: () => true,
			isGraphView: () => false,
			switchToTree: () => {},
			codeApi: () => ({ cmSearch }) as never,
			openGraphSearch: () => {},
			navigateToHit: () => {},
			afterReplace: async () => {},
		} as FindDeps);
		find.close();
		expect(cmSearch).toHaveBeenLastCalledWith('', false);
	});
});

describe('FindController — the query', () => {
	beforeEach(() => vi.clearAllMocks());

	it('Replace All in the tree replaces the text the search looked for, spaces included', async () => {
		const find = controller('h');
		vi.useFakeTimers();
		try {
			find.openFind();
			find.onQueryChange(' id');
			await vi.runAllTimersAsync();
		} finally {
			vi.useRealTimers();
		}
		await find.replaceAll();
		expect(ipc.docReplace).toHaveBeenCalledWith('h', ' id', '', false);
		expect(vi.mocked(ipc.docSearch).mock.calls.map((c) => c[1].query)).toEqual([' id', ' id']);
	});

	it('the Code view finds and replaces the text as typed, spaces included', () => {
		const cmSearch = vi.fn(() => ({ count: 1, current: 1 }));
		const cmReplaceAll = vi.fn(() => 1);
		const find = controller('h', {
			isCodeView: () => true,
			codeApi: () => ({ cmSearch, cmReplaceAll }) as never,
		});
		find.openFind();
		find.onQueryChange(' id');
		void find.replaceAll();
		expect(cmSearch.mock.calls.slice(1)).toEqual([
			[' id', false],
			[' id', false],
		]);
		expect(cmReplaceAll).toHaveBeenCalledWith(' id', '', false);
	});
});

describe('FindController — switching views with find open', () => {
	beforeEach(() => vi.clearAllMocks());

	it('searches the tree for the new view without jumping to a hit', async () => {
		vi.mocked(ipc.docSearch).mockResolvedValueOnce([hit]);
		let code = true;
		const navigateToHit = vi.fn();
		const find = controller('h', {
			isCodeView: () => code,
			codeApi: () => ({ cmSearch: () => ({ count: 1, current: 1 }) }) as never,
			navigateToHit,
		});
		find.openFind();
		find.onQueryChange('foo');
		code = false;
		find.syncActiveView();
		await vi.waitFor(() => expect(find.hits).toHaveLength(1));
		expect(navigateToHit).not.toHaveBeenCalled();
	});
});

describe('FindController — the Code view counter', () => {
	it('shows the number of the match the editor selected', () => {
		const find = controller('h', {
			isCodeView: () => true,
			codeApi: () => ({ cmSearch: () => ({ count: 3, current: 2 }) }) as never,
		});
		find.openFind();
		find.onQueryChange('foo');
		expect(find.counter).toBe('2 / 3');
	});

	it('Next and Previous show the number of the match the editor selected', () => {
		const cmFindNext = vi.fn(() => ({ count: 3, current: 1 }));
		const cmFindPrev = vi.fn(() => ({ count: 3, current: 2 }));
		const find = controller('h', {
			isCodeView: () => true,
			codeApi: () =>
				({ cmSearch: () => ({ count: 3, current: 1 }), cmFindNext, cmFindPrev }) as never,
		});
		find.openFind();
		find.onQueryChange('foo');
		find.next();
		expect(cmFindNext).toHaveBeenCalledWith('foo', false);
		expect(find.counter).toBe('1 / 3');
		find.prev();
		expect(cmFindPrev).toHaveBeenCalledWith('foo', false);
		expect(find.counter).toBe('2 / 3');
	});
});

describe('FindController — Replace All', () => {
	beforeEach(() => vi.clearAllMocks());

	it('ignores a second press while the first is still replacing', async () => {
		const find = controller('h');
		find.openFind();
		find.query = 'a';
		find.replaceValue = 'aa';
		await Promise.all([find.replaceAll(), find.replaceAll()]);
		expect(ipc.docReplace).toHaveBeenCalledTimes(1);
	});

	it.each([
		[5, 3, 0, 'replaced 5 matches in 3 values'],
		[1, 1, 0, 'replaced 1 match in 1 value'],
		[4, 2, 1, 'replaced 4 matches in 2 values and 1 key'],
		[2, 0, 2, 'replaced 2 matches in 2 keys'],
	])('reports count %i, values %i, keys %i as "%s"', async (count, values, keys, status) => {
		vi.mocked(ipc.docReplace).mockResolvedValueOnce({ count, values, keys, applied: null });
		const find = controller('h');
		find.openFind();
		find.query = 'a';
		await find.replaceAll();
		expect(find.replaceStatus).toBe(status);
	});
});

describe('FindController — cancelling a search', () => {
	beforeEach(() => vi.clearAllMocks());

	it('drops the hits of the previous query', async () => {
		vi.mocked(ipc.docSearch).mockResolvedValueOnce([hit]);
		vi.useFakeTimers();
		try {
			const find = controller('h');
			find.openFind();
			find.onQueryChange('foo');
			await vi.runAllTimersAsync();
			expect(find.counter).toBe('1 / 1');
			find.onQueryChange('foobar');
			find.cancel();
			await vi.runAllTimersAsync();
			expect(find.hits).toEqual([]);
			expect(find.counter).toBe('no matches');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('FindController — the tree counter at the search cap', () => {
	beforeEach(() => vi.clearAllMocks());

	it('shows the total as a lower bound when the engine stops at 10,000 hits', async () => {
		vi.mocked(ipc.docSearch).mockResolvedValueOnce(Array.from({ length: 10_000 }, () => hit));
		vi.useFakeTimers();
		try {
			const find = controller('h');
			find.openFind();
			find.onQueryChange('foo');
			await vi.runAllTimersAsync();
			expect(find.counter).toBe('1 / 10000+');
		} finally {
			vi.useRealTimers();
		}
	});
});
