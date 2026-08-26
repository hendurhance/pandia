import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
	unifiedDiff,
	changeAnchors,
	changeCounts,
} from '../../src/lib/views/compare/logic/linediff.ts';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..', '..');
const FIXTURE_DIR = join(ROOT, 'bench', 'fixtures');
const RESULTS_PATH = join(ROOT, 'bench', 'results', 'js-diff.json');

const LCS_CELL_CAP = 4_000_000;
const PER_RUN_LIMIT_MS = 60_000;
const CHILD_KILL_MS = 90_000;
const MANIFEST_WAIT_SEC = Number(process.env.BENCH_WAIT_SEC ?? 300);

interface ManifestEntry {
	name: string;
	shape: string;
	leftLines: number;
	rightLines: number;
	leftBytes: number;
	rightBytes: number;
	editPattern: string;
	expectedChangedLines: number;
	lcsCells: number;
}

interface Measurement {
	medianMs: number;
	runs: number;
	singleRun: boolean;
	peakHeapBytes: number;
	heapDeltaBytes: number;
	anchorsMs: number;
	hunks: number;
	adds: number;
	dels: number;
	middleA: number;
	middleB: number;
	capFired: boolean;
	overLimit: boolean;
}

interface ResultRecord {
	impl: 'js/linediff';
	fixture: string;
	medianMs: number;
	peakHeapBytes: number;
	hunks: number;
	changedLines: number;
	quality: 'ok' | 'degraded' | 'fake' | 'timeout';
}

const forceGc: () => void = (globalThis as { gc?: () => void }).gc ?? (() => {});
if (!(globalThis as { gc?: () => void }).gc) {
	console.error('warning: gc() not exposed; heap numbers will include uncollected garbage');
}

function middleDims(leftText: string, rightText: string): { a: number; b: number } {
	const L = leftText.split('\n');
	const R = rightText.split('\n');
	let pre = 0;
	while (pre < L.length && pre < R.length && L[pre] === R[pre]) pre++;
	let endL = L.length;
	let endR = R.length;
	while (endL > pre && endR > pre && L[endL - 1] === R[endR - 1]) {
		endL--;
		endR--;
	}
	return { a: endL - pre, b: endR - pre };
}

function median(values: number[]): number {
	const s = [...values].sort((x, y) => x - y);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function measureCase(leftText: string, rightText: string): Measurement {
	const { a, b } = middleDims(leftText, rightText);
	const capFired = a > 0 && b > 0 && a * b > LCS_CELL_CAP;

	const diffTimes: number[] = [];
	const anchorTimes: number[] = [];
	let peakHeapBytes = 0;
	let heapDeltaBytes = 0;
	let hunks = 0;
	let adds = 0;
	let dels = 0;

	const timedRun = () => {
		forceGc();
		const baseline = process.memoryUsage().heapUsed;
		const t0 = performance.now();
		const rows = unifiedDiff(leftText, rightText);
		const diffMs = performance.now() - t0;
		const sample = process.memoryUsage().heapUsed;
		const t1 = performance.now();
		const anchors = changeAnchors(rows);
		const counts = changeCounts(rows);
		const anchorsMs = performance.now() - t1;
		peakHeapBytes = Math.max(peakHeapBytes, sample);
		heapDeltaBytes = Math.max(heapDeltaBytes, sample - baseline);
		hunks = anchors.length;
		adds = counts.adds;
		dels = counts.dels;
		return { diffMs, anchorsMs };
	};

	const warmup = timedRun();
	let runsWanted: number;
	if (warmup.diffMs > 25_000) {
		runsWanted = 0;
	} else if (warmup.diffMs > 2_000) {
		runsWanted = 3;
	} else {
		runsWanted = Math.min(30, Math.max(5, Math.ceil(1_000 / Math.max(warmup.diffMs, 0.5))));
	}
	for (let i = 0; i < runsWanted; i++) {
		const r = timedRun();
		diffTimes.push(r.diffMs);
		anchorTimes.push(r.anchorsMs);
	}
	const singleRun = runsWanted === 0;
	if (singleRun) {
		diffTimes.push(warmup.diffMs);
		anchorTimes.push(warmup.anchorsMs);
	}

	return {
		medianMs: median(diffTimes),
		runs: diffTimes.length,
		singleRun,
		peakHeapBytes,
		heapDeltaBytes,
		anchorsMs: median(anchorTimes),
		hunks,
		adds,
		dels,
		middleA: a,
		middleB: b,
		capFired,
		overLimit: Math.max(...diffTimes) > PER_RUN_LIMIT_MS,
	};
}

function verdict(m: Measurement, expectedChangedLines: number): ResultRecord['quality'] {
	if (m.overLimit) return 'timeout';
	if (m.capFired) return 'fake';
	const changed = m.adds + m.dels;
	return changed <= expectedChangedLines * 2.25 + 5 ? 'ok' : 'degraded';
}

function toRecord(fixture: string, m: Measurement, quality: ResultRecord['quality']): ResultRecord {
	return {
		impl: 'js/linediff',
		fixture,
		medianMs: Math.round(m.medianMs * 10) / 10,
		peakHeapBytes: m.peakHeapBytes,
		hunks: m.hunks,
		changedLines: m.adds + m.dels,
		quality,
	};
}

function childMain(leftPath: string, rightPath: string): void {
	const leftText = readFileSync(leftPath, 'utf8');
	const rightText = readFileSync(rightPath, 'utf8');
	console.log(JSON.stringify(measureCase(leftText, rightText)));
}

function runChild(leftPath: string, rightPath: string): Measurement | 'killed' {
	const res = spawnSync(
		process.execPath,
		['--expose-gc', '--experimental-strip-types', SELF, '--measure', leftPath, rightPath],
		{ timeout: CHILD_KILL_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
	);
	if (res.signal || res.status !== 0) {
		if (res.signal !== 'SIGTERM' && res.stderr) console.error(res.stderr);
		return 'killed';
	}
	const lines = res.stdout.trim().split('\n');
	return JSON.parse(lines[lines.length - 1]) as Measurement;
}

const MB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

function printTable(rows: (ResultRecord & { detail: Measurement | null; expected: number })[]) {
	const header = [
		'fixture',
		'quality',
		'medianMs',
		'runs',
		'peakHeapMB',
		'deltaMB',
		'hunks',
		'changed',
		'expected',
		'lcsCellsM',
		'cap',
		'anchorsMs',
	];
	const table = rows.map((r) => {
		const d = r.detail;
		return [
			r.fixture,
			r.quality,
			r.medianMs.toFixed(1),
			d ? `${d.runs}${d.singleRun ? ' (single)' : ''}` : '-',
			MB(r.peakHeapBytes),
			d ? MB(d.heapDeltaBytes) : '-',
			String(r.hunks),
			String(r.changedLines),
			String(r.expected),
			d ? ((d.middleA * d.middleB) / 1e6).toFixed(2) : '-',
			d?.capFired ? 'FIRED' : '-',
			d ? d.anchorsMs.toFixed(2) : '-',
		];
	});
	const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
	const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
	console.log(fmt(header));
	console.log(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const row of table) console.log(fmt(row));
}

function selfTest(): (ResultRecord & { detail: Measurement; expected: number })[] {
	const leftLines = Array.from({ length: 300 }, (_, i) => `\t"item-${i}": ${i},`);
	const rightLines = [...leftLines];
	for (const i of [40, 150, 260]) rightLines[i] = `\t"item-${i}": "edited",`;
	rightLines.splice(200, 0, '\t"inserted-a": true,', '\t"inserted-b": false,');
	const smallLeft = `{\n${leftLines.join('\n')}\n}`;
	const smallRight = `{\n${rightLines.join('\n')}\n}`;

	const capLeft = ['{', ...Array.from({ length: 2098 }, (_, i) => `\t"l-${i}": ${i},`), '}'].join(
		'\n',
	);
	const capRight = ['{', ...Array.from({ length: 2098 }, (_, i) => `\t"r-${i}": ${i},`), '}'].join(
		'\n',
	);

	const small = measureCase(smallLeft, smallRight);
	const cap = measureCase(capLeft, capRight);

	const failures: string[] = [];
	if (small.adds + small.dels !== 8) {
		failures.push(`selftest-small: expected 8 changed lines, got ${small.adds + small.dels}`);
	}
	if (small.capFired) failures.push('selftest-small: cap fired on a tiny input');
	if (small.hunks !== 4) failures.push(`selftest-small: expected 4 hunks, got ${small.hunks}`);
	if (!cap.capFired) failures.push('selftest-capfire: cap did not fire');
	if (cap.adds + cap.dels !== 2098 * 2) {
		failures.push(
			`selftest-capfire: expected ${2098 * 2} changed lines, got ${cap.adds + cap.dels}`,
		);
	}
	if (failures.length > 0) {
		for (const f of failures) console.error(`SELF-TEST FAIL: ${f}`);
		process.exit(1);
	}
	console.log('self-test passed (small diff exact; cap-fire detected)\n');
	return [
		{ ...toRecord('selftest-small', small, verdict(small, 8)), detail: small, expected: 8 },
		{ ...toRecord('selftest-capfire', cap, verdict(cap, 20)), detail: cap, expected: 20 },
	];
}

async function waitForManifest(): Promise<ManifestEntry[] | null> {
	const manifestPath = join(FIXTURE_DIR, 'manifest.json');
	const deadline = Date.now() + MANIFEST_WAIT_SEC * 1000;
	let announced = false;
	while (Date.now() < deadline) {
		if (existsSync(manifestPath)) {
			await sleep(2_000);
			return JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
		}
		if (!announced) {
			console.log(`waiting up to ${MANIFEST_WAIT_SEC}s for bench/fixtures/manifest.json ...`);
			announced = true;
		}
		await sleep(5_000);
	}
	return null;
}

async function parentMain(): Promise<void> {
	const selfTestRows = selfTest();
	const manifest = await waitForManifest();

	const rows: (ResultRecord & { detail: Measurement | null; expected: number })[] = [];
	if (manifest) {
		for (const entry of manifest) {
			const leftPath = join(FIXTURE_DIR, `${entry.name}.left.json`);
			const rightPath = join(FIXTURE_DIR, `${entry.name}.right.json`);
			if (!existsSync(leftPath) || !existsSync(rightPath)) {
				console.error(`skipping ${entry.name}: fixture files missing`);
				continue;
			}
			process.stdout.write(`running ${entry.name} ... `);
			const m = runChild(leftPath, rightPath);
			if (m === 'killed') {
				console.log(`killed after ${CHILD_KILL_MS / 1000}s`);
				rows.push({
					impl: 'js/linediff',
					fixture: entry.name,
					medianMs: CHILD_KILL_MS,
					peakHeapBytes: 0,
					hunks: 0,
					changedLines: 0,
					quality: 'timeout',
					detail: null,
					expected: entry.expectedChangedLines,
				});
				continue;
			}
			const q = verdict(m, entry.expectedChangedLines);
			console.log(`${m.medianMs.toFixed(1)}ms ${q}`);
			if (m.middleA * m.middleB !== entry.lcsCells) {
				console.log(
					`  note: post-trim cells ${m.middleA * m.middleB} != manifest lcsCells ${entry.lcsCells}`,
				);
			}
			rows.push({ ...toRecord(entry.name, m, q), detail: m, expected: entry.expectedChangedLines });
		}
	} else {
		console.log('\nreal fixtures never appeared; reporting self-test results only');
	}

	console.log('');
	const allRows = manifest ? rows : selfTestRows;
	printTable(allRows);

	mkdirSync(dirname(RESULTS_PATH), { recursive: true });
	const records: ResultRecord[] = allRows.map(
		({ impl, fixture, medianMs, peakHeapBytes, hunks, changedLines, quality }) => ({
			impl,
			fixture,
			medianMs,
			peakHeapBytes,
			hunks,
			changedLines,
			quality,
		}),
	);
	writeFileSync(RESULTS_PATH, `${JSON.stringify(records, null, '\t')}\n`);
	console.log(`\nwrote ${RESULTS_PATH}`);
}

const measureIdx = process.argv.indexOf('--measure');
if (measureIdx !== -1) {
	childMain(process.argv[measureIdx + 1], process.argv[measureIdx + 2]);
} else {
	await parentMain();
}
