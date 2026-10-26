// Only relative imports: scripts/release-notes.ts runs this file directly in Node.
import type { Release } from '../../../../website/src/data/releases';

export type ReleaseGroup = Release['groups'][number];

export type Segment =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'link'; text: string; href: string };

const SITE = 'https://www.pandia.app';

export const CHANGELOG_URL = `${SITE}/changelog`;

export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

export function unseenVersions(
	versions: readonly string[],
	seen: { running: string; lastSeen: string | null; existingUser: boolean },
): string[] {
	const { running, lastSeen, existingUser } = seen;
	if (!versions.includes(running)) return [];
	// No record yet: an existing user upgraded from a version without this feature.
	if (lastSeen === null) return existingUser ? [running] : [];
	return versions.filter(
		(v) => compareVersions(v, lastSeen) > 0 && compareVersions(v, running) <= 0,
	);
}

function safeHref(href: string): string | null {
	const absolute = href.startsWith('/') && !href.startsWith('//') ? SITE + href : href;
	try {
		const url = new URL(absolute);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export function inlineSegments(text: string): Segment[] {
	const out: Segment[] = [];
	const pushText = (t: string) => {
		const last = out.at(-1);
		if (last?.kind === 'text') last.text += t;
		else if (t) out.push({ kind: 'text', text: t });
	};
	let at = 0;
	for (const m of text.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
		pushText(text.slice(at, m.index));
		at = m.index + m[0].length;
		const [whole, code, label, href] = m;
		if (code !== undefined) {
			out.push({ kind: 'code', text: code });
			continue;
		}
		const safe = safeHref(href ?? '');
		if (safe && label !== undefined) out.push({ kind: 'link', text: label, href: safe });
		else pushText(whole);
	}
	pushText(text.slice(at));
	return out;
}

// On GitHub a site-relative link would resolve against github.com.
const absoluteLinks = (s: string) => s.replace(/\]\(\/(?!\/)/g, `](${SITE}/`);

export function toMarkdown(release: Release): string {
	return release.groups
		.map((g) => {
			const items = g.items.map(
				(it) =>
					`- **${absoluteLinks(it.title)}**${it.detail === undefined ? '' : `: ${absoluteLinks(it.detail)}`}`,
			);
			return `### ${g.label}\n\n${items.join('\n')}`;
		})
		.join('\n\n');
}

export function fromMarkdown(md: string): ReleaseGroup[] | null {
	const groups: ReleaseGroup[] = [];
	for (const line of md.split(/\r?\n/)) {
		const heading = /^### (.+)$/.exec(line);
		if (heading?.[1]) {
			groups.push({ label: heading[1], items: [] });
			continue;
		}
		const item = /^- \*\*(.+?)\*\*(?:: (.+))?$/.exec(line);
		const group = groups.at(-1);
		if (!item?.[1] || !group) continue;
		group.items.push(
			item[2] === undefined ? { title: item[1] } : { title: item[1], detail: item[2] },
		);
	}
	const filled = groups.filter((g) => g.items.length > 0);
	return filled.length > 0 ? filled : null;
}
