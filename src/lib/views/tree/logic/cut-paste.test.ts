import { describe, it, expect, vi } from 'vitest';
import { ipc } from '$lib/ipc/client';
import { asLosslessText } from '$lib/ipc/wire';
import type { Op, Path } from '$lib/ipc/bindings';
import type { PromptController } from '$lib/ui/prompt.svelte';
import { createNodeActions, type CutMark } from './node-actions';
import type { ContentRow } from './model';

vi.mock('$lib/ipc/client', () => ({ ipc: { docGetValue: vi.fn() } }));

const clipboard = vi.hoisted(() => {
	let text = '';
	return {
		writeText: async (t: string) => void (text = t),
		readText: async () => text,
	};
});
vi.mock('@tauri-apps/plugin-clipboard-manager', () => clipboard);

function row(path: Path): ContentRow {
	return { path, key: path[path.length - 1], depth: path.length, kind: 'string' } as ContentRow;
}

describe('cut, another edit, then paste', () => {
	it('keeps the value that slid into the cut index', async () => {
		const doc: unknown[] = ['a', 'b', 'c', 'd'];
		vi.mocked(ipc.docGetValue).mockImplementation(async (_h, p: Path) =>
			asLosslessText(JSON.stringify(doc[p[0] as number])),
		);
		const apply = async (op: Op) => {
			if (op.kind === 'deleteItem') doc.splice(op.index, 1);
			else if (op.kind === 'insertItemText') doc.splice(op.index, 0, JSON.parse(op.text));
			else throw new Error(`unexpected ${op.kind}`);
			return { version: 1, affectedPaths: [] };
		};
		let cut: CutMark | null = null;
		const flash = vi.fn();
		const actions = createNodeActions({
			handle: () => 'h' as never,
			rows: () => [],
			selectedIndex: () => -1,
			setSelectedPath: () => {},
			siblingCount: () => doc.length,
			prompt: {} as PromptController,
			apply,
			setError: vi.fn(),
			flash,
			onOpenInNewTab: () => {},
			getCutMark: () => cut,
			setCutMark: (m) => (cut = m),
		});

		await actions.cut(row([2]));
		await actions.remove(row([0]));
		await actions.paste(row([0]));

		expect(doc).toEqual(['b', 'c', 'c', 'd']);
		expect(cut).toBeNull();
		expect(flash).toHaveBeenLastCalledWith(expect.stringContaining('pasted a copy'));
	});
});
