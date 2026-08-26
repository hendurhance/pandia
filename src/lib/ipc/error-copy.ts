import { IpcError } from './error';
import { fmtBytes } from '$lib/util/format';

const FALLBACK = 'Something went wrong.';

function sentence(s: string): string {
	return /[.!?]$/.test(s) ? s : `${s}.`;
}

function detailOf(message: string, ...prefixes: string[]): string {
	let out = message.trim();
	for (const p of prefixes) {
		if (out.toLowerCase().startsWith(p)) out = out.slice(p.length).trim();
	}
	return out;
}

function withDetail(lead: string, detail: string): string {
	return detail ? sentence(`${lead}: ${detail}`) : sentence(lead);
}

export function describeError(e: unknown): string {
	if (e instanceof IpcError) return describeIpc(e);
	if (e instanceof Error && e.message.trim()) return sentence(e.message.trim());
	if (typeof e === 'string' && e.trim()) return sentence(e.trim());
	return FALLBACK;
}

function describeIpc(e: IpcError): string {
	switch (e.kind) {
		case 'notFound':
			return 'This document is no longer open. Reopen the file and try again.';
		case 'invalidPath': {
			const path = detailOf(e.message, 'invalid path:');
			const where = path
				? `${path} no longer exists in this document`
				: 'That location no longer exists in this document';
			return `${where} — it may have been changed or removed by an earlier edit.`;
		}
		case 'tooLarge':
			return e.actual != null && e.limit != null
				? `This document is ${fmtBytes(e.actual)} — the limit for this action is ${fmtBytes(e.limit)}. Use a smaller file.`
				: 'This document is too large for this action. Use a smaller file.';
		case 'rangeTooLarge':
			return e.actual != null && e.limit != null
				? `Pandia requested ${e.actual} lines at once (the limit is ${e.limit}). This is a bug in Pandia, not a problem with your document.`
				: 'Pandia requested too many lines at once. This is a bug in Pandia, not a problem with your document.';
		case 'parse':
			return withDetail(
				"This isn't valid JSON",
				detailOf(e.message, 'parse error:', 'invalid json:'),
			);
		case 'edit':
			return withDetail("This edit can't be applied", detailOf(e.message, 'edit error:'));
		case 'schema':
			return withDetail("This schema can't be used", detailOf(e.message, 'schema error:'));
		case 'export':
			return withDetail('Export failed', detailOf(e.message, 'export error:'));
		case 'io':
			return withDetail("Couldn't read or write the file", detailOf(e.message, 'io error:'));
		case 'cancelled':
			return 'Cancelled.';
		default:
			return e.message.trim() ? sentence(e.message.trim()) : FALLBACK;
	}
}
