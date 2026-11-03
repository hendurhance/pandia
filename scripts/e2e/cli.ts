import { execFileSync, spawn } from 'node:child_process';
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Event = Record<string, unknown> & { event: string };
type Mode = 'cold' | 'warm';
interface Run {
	code: number | null;
	stdout: string;
	stderr: string;
}
interface Scenario {
	name: string;
	doc: string;
	modes: Mode[];
	run: (t: Check) => Promise<void>;
}

const [bundle, only] = process.argv.slice(2);
if (!bundle || !existsSync(bundle)) {
	console.error('Usage: node scripts/e2e/cli.ts <path to Pandia.app> [scenario]');
	process.exit(2);
}
const exe = join(resolve(bundle), 'Contents/MacOS/Pandia');

const appPattern = `^${exe} --ready-file=`;
const dir = mkdtempSync(join(tmpdir(), 'pandia-e2e-'));
const report = join(dir, 'report.jsonl');
const control = join(dir, 'control.jsonl');
const env = { ...process.env, PANDIA_E2E_REPORT: report, PANDIA_E2E_CONTROL: control };
const file = (name: string, contents: string) => {
	const path = join(dir, name);
	writeFileSync(path, contents);
	return path;
};
const schema = file(
	'config.schema.json',
	JSON.stringify({ type: 'object', required: ['host'], properties: { host: { type: 'string' } } }),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function events(): Event[] {
	if (!existsSync(report)) return [];
	return readFileSync(report, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Event);
}

function appRunning(): boolean {
	try {
		execFileSync('pgrep', ['-f', appPattern]);
		return true;
	} catch {
		return false;
	}
}

async function quitApp(): Promise<void> {
	try {
		execFileSync('pkill', ['-f', appPattern]);
	} catch {}
	for (let i = 0; i < 40 && appRunning(); i++) await sleep(100);
}

function pandia(args: string[], opts: { stdin?: string; timeoutMs?: number } = {}): Promise<Run> {
	return new Promise((done) => {
		const child = spawn(exe, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.stdin.end(opts.stdin ?? '');
		const timer = setTimeout(() => {
			child.kill();
			done({ code: null, stdout, stderr: `${stderr}[timed out]` });
		}, opts.timeoutMs ?? 30_000);
		child.on('exit', (code) => {
			clearTimeout(timer);
			done({ code, stdout, stderr });
		});
	});
}

async function waitFor<T>(find: () => T | undefined, timeoutMs = 30_000): Promise<T | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const found = find();
		if (found !== undefined) return found;
		await sleep(200);
	}
	return undefined;
}

class Check {
	readonly failures: string[] = [];
	private readonly start = events().length;

	events(): Event[] {
		return events().slice(this.start);
	}

	tab(match: (e: Event) => boolean, timeoutMs?: number): Promise<Event | undefined> {
		return waitFor(() => this.events().find((e) => e.event === 'tab-ready' && match(e)), timeoutMs);
	}

	async act(...ids: string[]): Promise<void> {
		for (const id of ids) {
			const before = this.events().filter((e) => e.event === 'ran').length;
			appendFileSync(control, `${JSON.stringify({ run: id })}\n`);
			const ran = await waitFor(() => {
				const n = this.events().filter((e) => e.event === 'ran').length;
				return n > before ? true : undefined;
			}, 10_000);
			if (!ran) this.fail(`the app never ran ${id}`);
			await sleep(400);
		}
	}

	expect(what: string, got: unknown, want: unknown): void {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		if (!ok) this.fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
	}

	fail(message: string): void {
		this.failures.push(message.replaceAll(dir, '<tmp>'));
	}
}

const valid = () =>
	file(`valid-${Date.now()}.json`, JSON.stringify({ host: 'https://example.invalid' }));
const invalid = () => file(`invalid-${Date.now()}.json`, JSON.stringify({ host: 7 }));
const isFor = (path: string) => (e: Event) => e.source === path;

const scenarios: Scenario[] = [
	{
		name: 'open-file',
		doc: 'pandia data.json — each file opens as a new tab. The command returns straight away.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = valid();
			const started = Date.now();
			const r = await pandia([path], { timeoutMs: 10_000 });
			t.expect('exit code', r.code, 0);
			if (Date.now() - started > 5000)
				t.fail(`the command took ${Date.now() - started} ms to return`);
			t.expect('tab opened', (await t.tab(isFor(path)))?.opened, true);
		},
	},
	{
		name: 'open-two-files',
		doc: 'pandia a.json b.json — each file opens as a new tab.',
		modes: ['cold', 'warm'],
		async run(t) {
			const a = valid();
			await sleep(5);
			const b = valid();
			t.expect('exit code', (await pandia([a, b])).code, 0);
			t.expect('first tab opened', (await t.tab(isFor(a)))?.opened, true);
			t.expect('second tab opened', (await t.tab(isFor(b)))?.opened, true);
		},
	},
	{
		name: 'piped',
		doc: '- opens whatever is piped in, in a tab named stdin. Pandia keeps a temp copy … and deletes it when you close the tab.',
		modes: ['cold', 'warm'],
		async run(t) {
			t.expect('exit code', (await pandia(['-'], { stdin: '{"piped":true}' })).code, 0);
			const tab = await t.tab((e) => e.piped === true);
			t.expect('tab opened', tab?.opened, true);
			t.expect('tab name', tab?.name, 'stdin');
			const copy = tab?.source as string | undefined;
			if (!copy || !existsSync(copy)) return t.fail('no temp copy while the tab is open');
			await t.act('tab.close');
			if (await waitFor(() => (existsSync(copy) ? undefined : true), 5000)) return;
			t.fail('the temp copy is still there after closing the tab');
		},
	},
	{
		name: 'piped-yaml',
		doc: 'YAML, CSV and broken JSON are converted or repaired the same way as files you open.',
		modes: ['cold', 'warm'],
		async run(t) {
			await pandia(['-'], { stdin: 'server:\n  port: 8080\n' });
			t.expect('YAML tab opened', (await t.tab((e) => e.piped === true))?.opened, true);
		},
	},
	{
		name: 'diff',
		doc: '--diff opens the first file in Compare against the second.',
		modes: ['cold', 'warm'],
		async run(t) {
			const old = file(`old-${Date.now()}.json`, '{"a":1}');
			const next = file(`new-${Date.now()}.json`, '{"a":2}');
			t.expect('exit code', (await pandia(['--diff', old, next])).code, 0);
			t.expect('compared with', (await t.tab(isFor(old)))?.comparingWith, next);
		},
	},
	{
		name: 'schema',
		doc: '--schema fills the Schema panel for every file the command opens.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = valid();
			await pandia([path, '--schema', schema]);
			const tab = await t.tab(isFor(path));
			t.expect('schema source', tab?.schemaFrom, 'cli');
			t.expect('schema result', tab?.valid, true);
		},
	},
	{
		name: 'wait-valid',
		doc: '--wait exit 0: You closed the tabs and the Schema panel showed no errors.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = valid();
			const waiting = pandia(['--wait', path, '--schema', schema]);
			if (!(await t.tab(isFor(path)))) return t.fail('the tab never opened');
			await t.act('tab.close');
			t.expect('exit code', (await waiting).code, 0);
		},
	},
	{
		name: 'wait-invalid',
		doc: '--wait exit 1: The Schema panel showed errors.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = invalid();
			const waiting = pandia(['--wait', path, '--schema', schema]);
			if (!(await t.tab(isFor(path)))) return t.fail('the tab never opened');
			await t.act('tab.close');
			t.expect('exit code', (await waiting).code, 1);
		},
	},
	{
		name: 'wait-missing-file',
		doc: "--wait exit 1: a file didn't open.",
		modes: ['cold', 'warm'],
		async run(t) {
			const path = join(dir, 'missing.json');
			const waiting = pandia(['--wait', path]);
			const tab = await t.tab(isFor(path));
			t.expect('tab opened', tab?.opened, false);
			await t.act('tab.close');
			t.expect('exit code', (await waiting).code, 1);
		},
	},
	{
		name: 'wait-piped-save',
		doc: 'Edit the JSON, press Save to send it back, then close the tab. The command prints the saved JSON.',
		modes: ['cold', 'warm'],
		async run(t) {
			const waiting = pandia(['--wait', '-'], { stdin: '{"b":1,"a":2}' });
			if (!(await t.tab((e) => e.piped === true))) return t.fail('the tab never opened');
			await t.act('tree.sortKeysAsc', 'doc.save', 'tab.close');
			const r = await waiting;
			t.expect('exit code', r.code, 0);
			let sent: unknown = r.stdout;
			try {
				sent = Object.keys(JSON.parse(r.stdout));
			} catch {}
			t.expect('keys sent back, in order', sent, ['a', 'b']);
		},
	},
	{
		name: 'wait-piped-unsaved',
		doc: 'Closing the tab without saving sends nothing and exits with 3.',
		modes: ['cold', 'warm'],
		async run(t) {
			const waiting = pandia(['--wait', '-'], { stdin: '{"a":1}' });
			if (!(await t.tab((e) => e.piped === true))) return t.fail('the tab never opened');
			await t.act('tab.close');
			const r = await waiting;
			t.expect('exit code', r.code, 3);
			t.expect('stdout', r.stdout, '');
		},
	},
	{
		name: 'wait-json-report',
		doc: '--json prints one JSON report when the tabs close; each error names its location as a JSON Pointer.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = invalid();
			const waiting = pandia(['--wait', '--json', path, '--schema', schema]);
			if (!(await t.tab(isFor(path)))) return t.fail('the tab never opened');
			await t.act('tab.close');
			const r = await waiting;
			t.expect('exit code', r.code, 1);
			try {
				const rep = JSON.parse(r.stdout);
				const f = rep.files?.[0] ?? {};
				t.expect(
					'report',
					[rep.exitCode, f.path, f.opened, f.valid, f.errorCount, f.errors?.[0]?.pointer],
					[1, path, true, false, 1, '/host'],
				);
			} catch {
				t.fail(`stdout isn't a JSON report: ${JSON.stringify(r.stdout)}`);
			}
		},
	},
	{
		name: 'wait-app-quits',
		doc: '--wait exit 1: Pandia quit before you closed the tabs.',
		modes: ['cold', 'warm'],
		async run(t) {
			const path = valid();
			const waiting = pandia(['--wait', path]);
			if (!(await t.tab(isFor(path)))) return t.fail('the tab never opened');
			await quitApp();
			t.expect('exit code', (await waiting).code, 1);
		},
	},
	{
		name: 'mistyped',
		doc: 'Exit 2: The command was mistyped. Pandia prints what to fix.',
		modes: ['cold'],
		async run(t) {
			const r = await pandia(['--bogus', 'a.json']);
			t.expect('exit code', r.code, 2);
			if (!r.stderr.includes('--bogus')) t.fail(`stderr doesn't name the option: ${r.stderr}`);
			if (appRunning()) t.fail('a mistyped command started the app');
		},
	},
	{
		name: 'version-and-help',
		doc: '-v, --version: Show the installed version, like pandia 1.0.8. -h, --help: Show the options.',
		modes: ['cold'],
		async run(t) {
			const v = await pandia(['-v']);
			t.expect('version exit code', v.code, 0);
			if (!/^pandia \d+\.\d+\.\d+\n$/.test(v.stdout))
				t.fail(`version output: ${JSON.stringify(v.stdout)}`);
			const h = await pandia(['--help']);
			t.expect('help exit code', h.code, 0);
			for (const word of ['--schema', '--wait', 'pandia get']) {
				if (!h.stdout.includes(word)) t.fail(`--help doesn't mention ${word}`);
			}
			if (appRunning()) t.fail('-v or --help started the app');
		},
	},
	{
		name: 'headless',
		doc: 'Commands read a file, print the answer and exit. No window opens. 0 done, 1 the answer is no, 2 mistyped.',
		modes: ['cold'],
		async run(t) {
			const path = file('users.json', '{"users":[{"id":1},{"id":2}]}');
			const got = await pandia(['get', path, '$.users[1].id']);
			t.expect('get', [got.code, got.stdout], [0, '2\n']);
			const missing = await pandia(['get', path, '$.users[5]']);
			t.expect('missing path exit code', missing.code, 1);
			if (!missing.stderr.includes('$.users has 2 items'))
				t.fail(`missing path stderr: ${missing.stderr}`);
			t.expect('bad option exit code', (await pandia(['get', path, '$', '--fast'])).code, 2);
			if (appRunning()) t.fail('a headless command started the app');
		},
	},
	{
		name: 'schema-not-inherited',
		doc: '--schema fills the Schema panel for every file the command opens (and only those).',
		modes: ['cold', 'warm'],
		async run(t) {
			const a = file(
				`a-${Date.now()}.json`,
				JSON.stringify({ $schema: './config.schema.json', host: 'x' }),
			);
			await pandia([a]);
			t.expect('first file schema', (await t.tab(isFor(a)))?.schemaFrom, 'document');
			await t.act('doc.close');
			const b = valid();
			await pandia([b]);
			const tab = await t.tab(isFor(b));
			t.expect('second file schema', [tab?.schemaFrom, tab?.verdict], [null, 'none']);
		},
	},
	{
		name: 'schema-relative-repaired',
		doc: "validate.astro: A relative path is read from the document's folder.",
		modes: ['cold', 'warm'],
		async run(t) {
			const path = file(
				`broken-${Date.now()}.json`,
				'{"$schema": "./config.schema.json", "host": "x"',
			);
			await pandia([path]);
			const tab = await t.tab(isFor(path));
			t.expect(
				'schema',
				[tab?.schemaFrom, tab?.verdict, tab?.valid],
				['document', 'checked', true],
			);
		},
	},
	{
		name: 'no-backup-after-undo',
		doc: 'Crash-recovery backups are offered after an unexpected close, not after undoing to the saved state and closing.',
		modes: ['warm'],
		async run(t) {
			const list = () => (existsSync(BACKUPS) ? readdirSync(BACKUPS) : []);
			const before = new Set(list());
			const path = file(`undo-${Date.now()}.json`, '{"b":1,"a":2}');
			await pandia([path]);
			if (!(await t.tab(isFor(path)))) return t.fail('the tab never opened');
			await t.act('tree.sortKeysAsc');
			await sleep(1500);
			await t.act('doc.undo', 'tab.close');
			await sleep(1500);
			t.expect(
				'new backups left behind',
				list().filter((f) => !before.has(f)),
				[],
			);
		},
	},
	{
		name: 'large-file-warning-off',
		doc: 'Settings → Behavior: large file warning off means a file over 200 MB opens without asking, cold start included.',
		modes: ['cold'],
		async run(t) {
			const big = join(dir, 'big.json');
			const fd = openSync(big, 'w');
			const chunk = `"${'x'.repeat(1 << 20)}",`;
			writeSync(fd, '[');
			for (let i = 0; i < 205; i++) writeSync(fd, chunk);
			writeSync(fd, '0]');
			closeSync(fd);
			await withBehavior({ warnLargeFileOpen: false }, async () => {
				await pandia([big]);
				t.expect('opened without a prompt', (await t.tab(isFor(big), 90_000))?.opened, true);
			});
			rmSync(big, { force: true });
		},
	},
];

const DATA = join(homedir(), 'Library/Application Support/com.pandia.ide.dev');
const BACKUPS = join(DATA, 'backups');
const SETTINGS = join(DATA, 'pandia-settings.json');

async function withBehavior(
	patch: Record<string, unknown>,
	run: () => Promise<void>,
): Promise<void> {
	await quitApp();
	const before = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null;
	const saved = before ? JSON.parse(before) : {};
	saved.behavior = { ...saved.behavior, ...patch };
	writeFileSync(SETTINGS, JSON.stringify(saved));
	try {
		await run();
	} finally {
		await quitApp();
		if (before === null) rmSync(SETTINGS, { force: true });
		else writeFileSync(SETTINGS, before);
	}
}

async function prepare(mode: Mode): Promise<void> {
	if (mode === 'cold') return quitApp();
	if (appRunning()) return;
	const primer = file(`primer-${Date.now()}.json`, '{}');
	await pandia([primer]);
	await waitFor(() => events().find((e) => e.event === 'tab-ready' && e.source === primer));
}

let failed = 0;
try {
	for (const s of scenarios.filter((s) => !only || s.name === only)) {
		for (const mode of s.modes) {
			await prepare(mode);
			const t = new Check();
			try {
				await s.run(t);
			} catch (e) {
				t.fail(`threw: ${e instanceof Error ? e.message : String(e)}`);
			}
			const label = `${s.name} (${mode})`;
			if (t.failures.length === 0) {
				console.log(`PASS ${label}`);
				continue;
			}
			failed++;
			console.log(`FAIL ${label}\n     doc: ${s.doc}`);
			for (const f of t.failures) console.log(`     - ${f}`);
		}
	}
} finally {
	await quitApp();
	rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed.` : '\nAll passed.');
process.exit(failed ? 1 : 0);
