import type { NodeKind, Path } from '../../ipc/types';
import type { Row } from '../../views/tree/logic/model';
import type { ValidityStatus } from '../../shell/logic/status';

export function validityFromView(input: {
	viewMode: 'tree' | 'code' | 'grid' | 'graph' | 'compare';
	codeValid: { valid: boolean; message: string | null } | null;
	schemaResult: { valid: boolean; errorCount: number } | null;
}): ValidityStatus | null {
	if (input.viewMode === 'code' && input.codeValid) {
		return {
			kind: 'buffer',
			ok: input.codeValid.valid,
			detail: input.codeValid.message ?? undefined,
		};
	}
	if (input.schemaResult) {
		return {
			kind: 'schema',
			ok: input.schemaResult.valid,
			errors: input.schemaResult.errorCount,
		};
	}
	return null;
}

export function kindAtSelection(
	rows: ReadonlyArray<Row>,
	contentRowIdx: (p: Path) => number,
	selectedPath: Path | null,
	rootKind: NodeKind,
): NodeKind | null {
	if (selectedPath === null) return rootKind;
	if (selectedPath.length === 0) return rootKind;
	const idx = contentRowIdx(selectedPath);
	if (idx < 0) return null;
	const r = rows[idx];
	if (r && r.variant === 'content') return r.kind;
	return null;
}
