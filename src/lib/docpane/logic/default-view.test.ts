import { describe, expect, it } from 'vitest';
import type { Capabilities } from '$lib/ipc/bindings';
import { resolveDefaultView, type DefaultViewSummary } from './default-view';

const ALL: Capabilities = {
	edit: true,
	export: true,
	exportConverted: true,
	validate: true,
	sortFilter: true,
	codeView: true,
	graph: true,
	compare: true,
	typegen: true,
	typegenSchema: true,
};

function doc(
	over: Partial<DefaultViewSummary> = {},
	caps: Partial<Capabilities> = {},
): DefaultViewSummary {
	return {
		rootKind: 'object',
		rootChildCount: 3,
		...over,
		capabilities: { ...ALL, ...caps },
	};
}

describe('resolveDefaultView', () => {
	it('returns the preference unchanged when no summary is available', () => {
		expect(resolveDefaultView('tree', null)).toBe('tree');
		expect(resolveDefaultView('code', null)).toBe('code');
		expect(resolveDefaultView('grid', null)).toBe('grid');
		expect(resolveDefaultView('graph', null)).toBe('graph');
	});

	it('keeps tree for any document', () => {
		expect(resolveDefaultView('tree', doc())).toBe('tree');
		expect(resolveDefaultView('tree', doc({ rootKind: 'string' }))).toBe('tree');
	});

	it('keeps grid for a non-empty array root', () => {
		expect(resolveDefaultView('grid', doc({ rootKind: 'array' }))).toBe('grid');
	});

	it('falls back to tree for grid on a non-array root', () => {
		expect(resolveDefaultView('grid', doc())).toBe('tree');
		expect(resolveDefaultView('grid', doc({ rootKind: 'string' }))).toBe('tree');
	});

	it('falls back to tree for grid on an empty array root', () => {
		expect(resolveDefaultView('grid', doc({ rootKind: 'array', rootChildCount: 0 }))).toBe('tree');
		expect(resolveDefaultView('grid', doc({ rootKind: 'array', rootChildCount: null }))).toBe(
			'tree',
		);
	});

	it('keeps graph for container roots', () => {
		expect(resolveDefaultView('graph', doc())).toBe('graph');
		expect(resolveDefaultView('graph', doc({ rootKind: 'array' }))).toBe('graph');
	});

	it('falls back to tree for graph on a scalar root', () => {
		expect(resolveDefaultView('graph', doc({ rootKind: 'number', rootChildCount: null }))).toBe(
			'tree',
		);
		expect(resolveDefaultView('graph', doc({ rootKind: 'null', rootChildCount: null }))).toBe(
			'tree',
		);
	});

	it('keeps code when the document allows Code view', () => {
		expect(resolveDefaultView('code', doc())).toBe('code');
	});

	it('falls back to tree for code when the document is too large for Code view', () => {
		expect(resolveDefaultView('code', doc({}, { codeView: false }))).toBe('tree');
	});

	it('falls back to tree for graph when the document is read straight from disk', () => {
		expect(resolveDefaultView('graph', doc({}, { graph: false }))).toBe('tree');
	});
});
