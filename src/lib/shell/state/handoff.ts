import { ipc } from '$lib/ipc/client';
import { schemaSessions } from '$lib/panels/state/schema-store.svelte';
import type { DocHandle, PendingFile, TabReport } from '$lib/ipc/bindings';

export interface HandoffInstructions {
	schema: string | null;
	compareWith: string | null;
}

export class Handoff {
	private instructions: HandoffInstructions | null;
	private wasOpened = false;
	private problem: string | null = null;
	private wasSaved = false;
	private settled = false;
	private settling: Promise<void> | null = null;

	constructor(private readonly launch: PendingFile) {
		this.instructions =
			launch.schema || launch.compareWith
				? { schema: launch.schema, compareWith: launch.compareWith }
				: null;
	}

	static needed(file: PendingFile): boolean {
		return file.wait !== null || file.piped || file.schema !== null || file.compareWith !== null;
	}

	get waiting(): boolean {
		return this.launch.wait !== null;
	}

	get repliesToTerminal(): boolean {
		return this.launch.reply !== null;
	}

	get owes(): boolean {
		return !this.settled && (this.launch.wait !== null || this.launch.piped);
	}

	takeInstructions(): HandoffInstructions | null {
		const taken = this.instructions;
		this.instructions = null;
		return taken;
	}

	opened(): void {
		this.wasOpened = true;
		this.problem = null;
	}

	failed(problem: string): void {
		this.wasOpened = false;
		this.problem = problem;
	}

	recordSave(): void {
		this.wasSaved = true;
	}

	async sendBack(handle: DocHandle): Promise<void> {
		if (!this.launch.reply) return;
		await ipc.cliReply(handle, this.launch.reply);
		this.wasSaved = true;
	}

	settle(tabId: string): Promise<void> {
		this.settling ??= this.report(tabId);
		return this.settling;
	}

	abandon(problem: string): Promise<void> {
		this.settling ??= this.finish({ ...this.baseReport(), problem });
		return this.settling;
	}

	private async report(tabId: string): Promise<void> {
		const verdict = (await schemaSessions.existing(tabId)?.settleVerdict()) ?? { kind: 'none' };
		const result = verdict.kind === 'checked' ? verdict.result : null;
		const problem =
			this.problem ??
			(verdict.kind === 'problem' ? verdict.message : null) ??
			(this.wasOpened ? null : 'The tab closed before the file finished opening.');
		await this.finish({
			...this.baseReport(),
			opened: this.wasOpened,
			saved: this.wasSaved,
			valid: result?.valid ?? null,
			errorCount: result?.errorCount ?? 0,
			errors: (result?.errors ?? []).map((e) => ({ pointer: e.instancePath, message: e.message })),
			problem,
		});
	}

	private baseReport(): TabReport {
		return {
			path: this.launch.piped ? null : this.launch.path,
			opened: false,
			saved: false,
			valid: null,
			errorCount: 0,
			errors: [],
			problem: null,
		};
	}

	private async finish(report: TabReport): Promise<void> {
		this.settled = true;
		const { wait, piped, path } = this.launch;
		await Promise.all([
			wait ? ipc.cliWaitDone(wait, report).catch(() => {}) : null,
			piped ? ipc.cliDiscardPiped(path).catch(() => {}) : null,
		]);
	}
}
