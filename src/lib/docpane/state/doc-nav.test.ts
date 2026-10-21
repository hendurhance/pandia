// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { IpcError } from '$lib/ipc/error';
import { asLosslessText } from '$lib/ipc/wire';
import type { TreeRowsController } from '$lib/views/tree/state/tree-rows.svelte';
import type { PromptController } from '$lib/ui/prompt.svelte';
import { inRoot } from '$lib/views/shared/test-runes.svelte';
import { DocNavController } from './doc-nav.svelte';

vi.mock('$lib/ipc/client', () => ({
	ipc: {
		docGetValue: vi.fn(async () => asLosslessText('[1, 2, 3]')),
		docChildCount: vi.fn(),
	},
}));

const ensurePathVisible = vi.fn(async () => {});
const setError = vi.fn();

function goTo(input: string) {
	const { result: nav, destroy } = inRoot(
		() =>
			new DocNavController({
				tree: {
					rows: [],
					contentRowIdx: () => -1,
					ensurePathVisible,
				} as unknown as TreeRowsController,
				handle: () => 'doc',
				prompt: { show: async () => input } as unknown as PromptController,
				switchToTree: async () => true,
				setError,
			}),
	);
	return nav.goToPath().finally(destroy);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('DocNavController.goToPath', () => {
	it.each([
		['a container', '$.items', ['items'], 3],
		['a scalar', '$.name', ['name'], null],
	])('goes to %s without fetching its value', async (_, input, path, childCount) => {
		vi.mocked(ipc.docChildCount).mockResolvedValue(childCount);
		await goTo(input);
		expect(ipc.docGetValue).not.toHaveBeenCalled();
		expect(ensurePathVisible).toHaveBeenCalledWith(path);
		expect(setError).toHaveBeenLastCalledWith(null);
	});

	it('reports a path that does not exist and stays put', async () => {
		vi.mocked(ipc.docChildCount).mockRejectedValue(
			new IpcError('invalidPath', 'invalid path', { path: ['missing'] }),
		);
		await goTo('$.missing');
		expect(setError).toHaveBeenLastCalledWith('path not found: $.missing');
		expect(ensurePathVisible).not.toHaveBeenCalled();
	});
});
