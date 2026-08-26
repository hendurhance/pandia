import { readTextFile, stat } from '@tauri-apps/plugin-fs';
import { ipc } from '$lib/ipc/client';
import type { IpcErrorKind } from '$lib/ipc/error';
import type { DetectResult, DocHandle, OpenResult, OpenSource } from '$lib/ipc/bindings';
import { stem } from '$lib/util/path';

const MAX_WARNINGS = 6;

const DETECT_MAX_BYTES = 50 * 1024 * 1024;

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

export async function readSourceText(source: OpenSource): Promise<string | null> {
	if (source.kind === 'text') return source.text;
	try {
		return await readTextFile(source.path);
	} catch {
		return null;
	}
}

export interface FormatDetectDeps {
	error: () => string | null;

	errorKind: () => IpcErrorKind | null;

	reopen: (text: string, name: string) => Promise<void>;
}

export async function runFormatDetect(source: OpenSource, deps: FormatDetectDeps): Promise<void> {
	if (source.kind !== 'file') return;
	const err = deps.error();
	if (err == null || !isRepairableError(err, deps.errorKind())) return;

	try {
		const info = await stat(source.path);
		if (Number(info.size ?? 0) > DETECT_MAX_BYTES) return;
	} catch {
		return;
	}
	const text = await readSourceText(source);
	if (text == null) return;

	const first = /\S/.exec(text)?.[0];
	if (first == null || first === '{' || first === '[') return;

	let detected: DetectResult;
	try {
		detected = await ipc.docDetectAndConvert(text);
	} catch {
		return;
	}
	if (detected.error != null || detected.kind === 'json' || detected.kind === 'unknown') return;
	await deps.reopen(detected.json, `${stem(source.path)}.json`);
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
		repaired = await ipc.docRepairText(text);
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
				deps.setSummary(await ipc.docSetFilePath(handle, source.path));
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
