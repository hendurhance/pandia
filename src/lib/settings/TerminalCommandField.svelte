<script lang="ts">
	import { ipc } from '$lib/ipc/client';
	import { describeError } from '$lib/ipc/error-copy';
	import type { ShellCommand } from '$lib/ipc/bindings';
	import { isMac } from '$lib/util/platform';

	const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);

	let status = $state<ShellCommand | null>(null);
	let busy = $state(false);
	let error: string | null = $state(null);

	$effect(() => {
		void ipc.shellCommandStatus().then((s) => (status = s));
	});

	async function run(action: () => Promise<ShellCommand>) {
		busy = true;
		error = null;
		try {
			status = await action();
		} catch (e) {
			error = describeError(e);
		} finally {
			busy = false;
		}
	}

	const installNote = $derived(
		!status
			? ''
			: isWindows
				? `Creates ${status.location} and adds its folder to your PATH.`
				: isMac
					? `Creates ${status.location}. macOS may ask for your password.`
					: `Creates ${status.location}. That folder must be on your PATH.`,
	);
</script>

<section class="field">
	<div class="field-label">terminal command</div>
	<div class="field-control">
		{#if status?.installed}
			<div class="text-sm">
				Installed{status.removable ? '' : ' by Homebrew'} at <code>{status.location}</code>
			</div>
			{#if status.removable}
				<button class="btn self-start" disabled={busy} onclick={() => run(ipc.shellCommandRemove)}>
					Remove pandia command
				</button>
			{/if}
		{:else if status}
			<button class="btn self-start" disabled={busy} onclick={() => run(ipc.shellCommandInstall)}>
				Install pandia command
			</button>
			<div class="text-sm dim">{installNote}</div>
		{/if}
		<div class="text-sm dim">
			Open files with <code>pandia data.json</code>, pipe JSON in with <code>pandia -</code>, or
			compare two files with <code>pandia --diff a.json b.json</code>. Run
			<code>pandia --help</code> in a new terminal to see every option.
		</div>
		{#if error}
			<div class="text-sm err">{error}</div>
		{/if}
	</div>
</section>

<style>
	.err {
		color: var(--danger);
	}
</style>
