export interface MatchResult {
	score: number;
	ranges: Array<[number, number]>;
}

const NO_MATCH: MatchResult = { score: 0, ranges: [] };

const WORD_BOUNDARY_RE = /[\s_\-/.()[\]]/;

export function fuzzyMatch(query: string, label: string): MatchResult {
	if (!query) return { score: 1, ranges: [] };
	if (!label) return NO_MATCH;

	const q = query.toLowerCase();
	const l = label.toLowerCase();
	const ranges: Array<[number, number]> = [];

	let qi = 0;
	let li = 0;
	let raw = 0;
	let lastMatch = -2;
	let runStart = -1;

	while (qi < q.length && li < l.length) {
		if (q[qi] === l[li]) {
			let bonus = 1;
			if (li === lastMatch + 1) bonus += 1.2; // contiguous run
			if (li === 0 || WORD_BOUNDARY_RE.test(l[li - 1])) bonus += 2; // word boundary start
			if (label[li] === query[qi]) bonus += 0.5; // case agrees with original

			raw += bonus;
			if (runStart < 0) runStart = li;
			lastMatch = li;
			qi++;
		} else if (runStart >= 0) {
			ranges.push([runStart, lastMatch + 1]);
			runStart = -1;
		}
		li++;
	}

	if (qi < q.length) return NO_MATCH;
	if (runStart >= 0) ranges.push([runStart, lastMatch + 1]);

	const penalty = label.length / 200;
	const normalized = raw / (q.length * 4 + penalty);
	return { score: Math.min(1, normalized), ranges };
}

export function highlightLabel(label: string, ranges: Array<[number, number]>): string {
	if (ranges.length === 0) return escape(label);
	let out = '';
	let cur = 0;
	for (const [s, e] of ranges) {
		out += escape(label.slice(cur, s));
		out += `<mark>${escape(label.slice(s, e))}</mark>`;
		cur = e;
	}
	out += escape(label.slice(cur));
	return out;
}

function escape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
