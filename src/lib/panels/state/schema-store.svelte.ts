import type { SchemaValidationResult } from '$lib/ipc/types';

interface TabSchema {
	text: string;
	result: SchemaValidationResult | null;
	
	validatedVersion: number | null;
	busy: boolean;
	error: string | null;
}

const EMPTY: TabSchema = {
	text: '',
	result: null,
	validatedVersion: null,
	busy: false,
	error: null,
};

class SchemaStore {
	private byTab: Record<string, TabSchema> = $state({});

	get(tabId: string): TabSchema {
		return this.byTab[tabId] ?? EMPTY;
	}

	setText(tabId: string, text: string): void {
		const prev = this.byTab[tabId] ?? EMPTY;
		this.byTab = { ...this.byTab, [tabId]: { ...prev, text, error: null } };
	}

	setBusy(tabId: string, busy: boolean): void {
		const prev = this.byTab[tabId] ?? EMPTY;
		this.byTab = { ...this.byTab, [tabId]: { ...prev, busy } };
	}

	setResult(
		tabId: string,
		result: SchemaValidationResult | null,
		error: string | null,
		validatedVersion: number | null,
	): void {
		const prev = this.byTab[tabId] ?? EMPTY;
		this.byTab = {
			...this.byTab,
			[tabId]: { ...prev, result, error, validatedVersion, busy: false },
		};
	}

	clear(tabId: string): void {
		if (!(tabId in this.byTab)) return;
		const { [tabId]: _, ...rest } = this.byTab;
		this.byTab = rest;
	}
}

export const schemaStore = new SchemaStore();
