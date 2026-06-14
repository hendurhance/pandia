import { readTextFile } from '@tauri-apps/plugin-fs';
import { docRepairText, docSetFilePath, type IpcErrorKind } from '$lib/ipc/doc';
import type { DocHandle, OpenResult, OpenSource } from '$lib/ipc/types';

const MAX_WARNINGS = 6;

export interface RepairInfo {
	warnings: string[];
	more: number;
	wasUnescaped: boolean;
	cleanedUp: boolean;
}

export interface AutoRepairDeps {
	enabled: () => boolean;

	error: () => string | null;

	errorKind: () => IpcErrorKind | null;

	reopen: (text: string, name: string) => Promise<void>;

	handle: () => DocHandle | null;

	setSummary: (summary: OpenResult['summary']) => void;

	setRepairInfo: (info: RepairInfo) => void;
}

export function isRepairableError(error: string, kind?: IpcErrorKind | null): boolean {
	if (kind != null) return kind === 'parse';
	const lower = error.toLowerCase();
	return (
		lower.includes('parse') ||
		lower.includes('expected') ||
		lower.includes('eof') ||
		lower.includes('invalid')
	);
}

async function readSourceText(source: OpenSource): Promise<string | null> {
	if (source.kind === 'text') return source.text;
	try {
		return await readTextFile(source.path);
	} catch {
		return null;
	}
}

export async function runAutoRepair(
	source: OpenSource,
	name: string,
	deps: AutoRepairDeps,
): Promise<void> {
	if (!deps.enabled()) return;
	const err = deps.error();
	if (err == null || !isRepairableError(err, deps.errorKind())) return;

	const text = await readSourceText(source);
	if (text == null) return;

	let repaired;
	try {
		repaired = await docRepairText(text);
	} catch {
		return;
	}
	if (!repaired.success) return;

	await deps.reopen(repaired.repairedJson, name);
	if (deps.error() !== null) return;

	if (source.kind === 'file') {
		const handle = deps.handle();
		if (handle) {
			try {
				deps.setSummary(await docSetFilePath(handle, source.path));
			} catch {}
		}
	}
	deps.setRepairInfo({
		warnings: repaired.warnings.slice(0, MAX_WARNINGS),
		more: Math.max(0, repaired.warnings.length - MAX_WARNINGS),
		wasUnescaped: repaired.wasUnescaped,
		cleanedUp: repaired.cleanedUp,
	});
}
