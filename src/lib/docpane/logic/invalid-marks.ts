import type { Path } from '../../ipc/types';
import type { Row } from '../../views/tree/logic/model';
import { pathKey } from '../../views/tree/logic/model';
import { resolveJsonPointer } from '../../util/path';

export type InvalidMark = 'error' | 'ancestor' | 'stale-error' | 'stale-ancestor';

export interface ValidationError {
	instancePath: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

export interface InvalidMarksInput {
	
	result: ValidationResult | null;
	
	validatedVersion: number | null;
	
	liveVersion: number | null;
	
	rows: ReadonlyArray<Row>;
}

export function computeInvalidMarks(input: InvalidMarksInput): Map<string, InvalidMark> {
	const m = new Map<string, InvalidMark>();
	const { result, validatedVersion, liveVersion, rows } = input;
	if (!result || result.valid || result.errors.length === 0) return m;

	const stale =
		liveVersion != null && validatedVersion != null && liveVersion > validatedVersion;
	const errKind: InvalidMark = stale ? 'stale-error' : 'error';
	const ancKind: InvalidMark = stale ? 'stale-ancestor' : 'ancestor';

	const kindByPath = new Map<string, 'object' | 'array'>();
	for (const r of rows) {
		if (r.variant === 'content' && (r.kind === 'object' || r.kind === 'array')) {
			kindByPath.set(pathKey(r.path), r.kind);
		}
	}
	const kindOfParent = (prefix: Path) => kindByPath.get(pathKey(prefix)) ?? null;

	const paths = result.errors.map((e) => resolveJsonPointer(e.instancePath, kindOfParent));
	for (const p of paths) m.set(pathKey(p), errKind);
	for (const p of paths) {
		for (let i = 0; i < p.length; i++) {
			const k = pathKey(p.slice(0, i));
			if (!m.has(k)) m.set(k, ancKind);
		}
	}
	return m;
}
