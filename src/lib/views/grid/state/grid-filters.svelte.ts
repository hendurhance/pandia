import { docColumnValues, type ColumnValues } from '$lib/ipc/doc';
import type { ColumnSchema, DocHandle, NodeKind, Path } from '$lib/ipc/types';
import {
	type ColOp,
	type ColFilter,
	sameVal,
	colActive,
	compileGroups,
	valLabel,
} from '../logic/grid-filter-model';
import type { GridQuery } from './grid-data.svelte';

const VALUE_LIMIT = 200;

export interface GridFilterDeps {
	handle: () => DocHandle;
	path: () => Path;
	columns: () => ColumnSchema['columns'];
}

export class GridFilterController {
	sortKey: string | null = $state(null);
	sortDesc = $state(false);
	sortError: string | null = $state(null);

	quick = $state('');
	private debouncedQuickValue = $state('');
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	groups = $state.raw<Map<string, ColFilter>[]>([new Map()]);
	activeGroup = $state(0);

	get colFilters(): Map<string, ColFilter> {
		return this.groups[this.activeGroup] ?? new Map();
	}
	private set colFilters(map: Map<string, ColFilter>) {
		const next = this.groups.slice();
		next[this.activeGroup] = map;
		this.groups = next;
	}

	openCol: string | null = $state(null);
	openAnchor: { left: number; top: number } = $state({ left: 0, top: 0 });
	openAnchorEl: HTMLElement | null = $state(null); // funnel button (Popover ignores its clicks)
	openOp: ColOp = $state('is');
	valueSearch = $state('');
	valuesByCol = $state.raw(new Map<string, ColumnValues>());
	valuesLoading: string | null = $state(null);

	constructor(private deps: GridFilterDeps) {
		$effect(() => {
			const next = this.quick;
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			if (next === this.debouncedQuickValue) return;
			if (next === '') {
				this.debouncedQuickValue = '';
				return;
			}
			this.debounceTimer = setTimeout(() => {
				this.debouncedQuickValue = next;
			}, 500);
		});
	}

	readonly compiledGroups = $derived(compileGroups(this.groups));
	readonly quickKeys = $derived.by(() => this.deps.columns().map((c) => c.key));
	readonly filtering = $derived(
		this.compiledGroups.length > 0 || this.debouncedQuickValue.trim() !== '',
	);

	readonly groupColumns = $derived(
		this.groups.map((g) => [...g.entries()].filter(([, c]) => colActive(c))),
	);

	readonly hasFilter = $derived(
		this.groups.length > 1 || this.groupColumns.some((g) => g.length > 0),
	);

	readonly query = $derived.by<GridQuery>(() => ({
		sortKey: this.sortKey,
		sortDesc: this.sortDesc,
		filterGroups: this.compiledGroups,
		quick: this.debouncedQuickValue,
		quickKeys: this.quickKeys,
		filtering: this.filtering,
	}));

	readonly openValues = $derived.by(() => {
		if (!this.openCol) return null;
		const cv = this.valuesByCol.get(this.openCol);
		if (!cv) return null;
		const q = this.valueSearch.trim().toLowerCase();
		const values = q
			? cv.values.filter((v) => valLabel(v.value).toLowerCase().includes(q))
			: cv.values;
		return { values, capped: cv.capped };
	});

	readonly openOpChoices = $derived.by((): ColOp[] => {
		if (!this.openCol || this.colKind(this.openCol) === 'number') return [];
		return this.openValues?.capped
			? ['contains', 'startsWith']
			: ['is', 'isNot', 'contains', 'startsWith'];
	});

	readonly openListMode = $derived.by((): 'loading' | 'checklist' | 'text' | 'none' => {
		if (!this.openCol) return 'none';
		if (this.valuesLoading === this.openCol) return 'loading';
		if (this.colKind(this.openCol) === 'number') return 'none'; // range is the control
		if (this.openOp === 'contains' || this.openOp === 'startsWith') return 'text';
		if (!this.openValues || this.openValues.capped) return 'text';
		return 'checklist';
	});

	colKind = (key: string): NodeKind =>
		this.deps.columns().find((c) => c.key === key)?.dominantKind ?? 'string';

	updateCol = (key: string, patch: Partial<ColFilter>) => {
		const next = new Map(this.colFilters);
		const merged = { ...(next.get(key) ?? {}), ...patch };
		if (colActive(merged)) next.set(key, merged);
		else next.delete(key);
		this.colFilters = next;
	};

	clearColumn = (key: string) => {
		const next = new Map(this.colFilters);
		next.delete(key);
		this.colFilters = next;
	};

	clearColumnIn = (groupIdx: number, key: string) => {
		const g = this.groups[groupIdx];
		if (!g) return;
		const nextMap = new Map(g);
		nextMap.delete(key);
		let groups = this.groups.slice();
		groups[groupIdx] = nextMap;
		if (nextMap.size === 0 && groups.length > 1) {
			groups = groups.filter((_, k) => k !== groupIdx);
		}
		this.groups = groups;
		this.activeGroup = Math.min(this.activeGroup, this.groups.length - 1);
	};

	clearAll = () => {
		this.groups = [new Map()];
		this.activeGroup = 0;
		this.quick = '';
		this.openCol = null;
	};

	addGroup = () => {
		this.groups = [...this.groups, new Map()];
		this.activeGroup = this.groups.length - 1;
		this.openCol = null;
	};

	removeGroup = (i: number) => {
		this.groups = this.groups.length <= 1 ? [new Map()] : this.groups.filter((_, k) => k !== i);
		this.activeGroup = Math.min(this.activeGroup, this.groups.length - 1);
		this.openCol = null;
	};

	setActiveGroup = (i: number) => {
		if (i >= 0 && i < this.groups.length) this.activeGroup = i;
	};

	toggleValue = (key: string, value: unknown) => {
		const cur = this.colFilters.get(key)?.values ?? [];
		const next = cur.some((v) => sameVal(v, value))
			? cur.filter((v) => !sameVal(v, value))
			: [...cur, value];
		this.updateCol(key, { op: this.openOp, values: next });
	};

	isChecked = (key: string, value: unknown): boolean =>
		(this.colFilters.get(key)?.values ?? []).some((v) => sameVal(v, value));

	setText = (key: string, text: string) => {
		this.updateCol(key, { op: this.openOp, text });
	};

	setPresence = (key: string, p: 'empty' | 'notEmpty') => {
		this.updateCol(key, { presence: this.colFilters.get(key)?.presence === p ? undefined : p });
	};

	setOpenOp = (op: ColOp) => {
		this.openOp = op;
		if (this.openCol && this.colFilters.has(this.openCol)) {
			this.updateCol(
				this.openCol,
				op === 'contains' || op === 'startsWith'
					? { op, values: undefined }
					: { op, text: undefined },
			);
		}
	};

	openFilter = (e: MouseEvent, key: string) => {
		e.stopPropagation();
		if (this.openCol === key) {
			this.openCol = null;
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		this.openAnchor = { left: rect.left, top: rect.bottom + 4 };
		this.openAnchorEl = e.currentTarget as HTMLElement;
		this.valueSearch = '';
		this.openOp = this.colFilters.get(key)?.op ?? 'is';
		this.openCol = key;
		void this.loadValues(key);
	};

	private async loadValues(key: string) {
		if (this.valuesByCol.has(key)) return;
		this.valuesLoading = key;
		try {
			const cv = await docColumnValues(this.deps.handle(), this.deps.path(), key, VALUE_LIMIT);
			const next = new Map(this.valuesByCol);
			next.set(key, cv);
			this.valuesByCol = next;
		} catch {
		} finally {
			this.valuesLoading = null;
		}
	}

	toggleSort = (key: string) => {
		this.sortError = null;
		if (this.sortKey !== key) {
			this.sortKey = key;
			this.sortDesc = false;
		} else if (!this.sortDesc) {
			this.sortDesc = true;
		} else {
			this.sortKey = null;
			this.sortDesc = false;
		}
	};

	closeDropdown = () => {
		this.openCol = null;
	};

	coerceCappedOp = () => {
		if (
			this.openCol &&
			this.openValues?.capped &&
			(this.openOp === 'is' || this.openOp === 'isNot')
		) {
			this.openOp = 'contains';
		}
	};

	resetValues = () => {
		this.valuesByCol = new Map();
		this.openCol = null;
	};

	resetOnOverflow = (message: string) => {
		this.sortError = message;
		this.sortKey = null;
		this.sortDesc = false;
		this.groups = [new Map()];
		this.activeGroup = 0;
		this.quick = '';
		this.debouncedQuickValue = '';
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	};
}
