import { readFileSync } from 'node:fs';
import type { Release } from '../website/src/data/releases.ts';
import { toMarkdown } from '../src/lib/shell/logic/release-notes.ts';

const releases: Release[] = JSON.parse(
	readFileSync(new URL('../website/src/data/releases.json', import.meta.url), 'utf8'),
);

const version = (process.argv[2] ?? '').replace(/^v/, '');
const release = releases.find((r) => r.version === version);
if (!release) {
	console.error(
		`No release notes for "${version}" in website/src/data/releases.json. Add them before releasing.`,
	);
	process.exit(1);
}
console.log(toMarkdown(release));
