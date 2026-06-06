<script lang="ts">
	import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
	import { readTextFile, writeFile } from '@tauri-apps/plugin-fs';
	import { recentsStore, clearRecents } from '$lib/shell/state/recents-store.svelte';
	import { appearancePrefs } from './state/appearance-prefs.svelte';
	import { behaviorPrefs } from './state/behavior-prefs.svelte';
	import { sidebarPrefs } from '$lib/shell/state/sidebar-prefs.svelte';
	import { typegenPrefs } from '$lib/panels/state/typegen-prefs.svelte';
	import { exportSettings, importSettings, PERSISTED_FILES } from '$lib/util/persist';

	// Window between two clicks of a destructive button before the second
	// click reverts to "needs confirmation" again.
	const CONFIRM_ARM_MS = 3000;
	const BUNDLE_FLASH_MS = 3500;

	let armed: string | null = $state(null);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	function arm(id: string, action: () => void) {
		if (armed === id) {
			if (armTimer) clearTimeout(armTimer);
			armed = null;
			action();
			return;
		}
		armed = id;
		if (armTimer) clearTimeout(armTimer);
		armTimer = setTimeout(() => (armed = null), CONFIRM_ARM_MS);
	}


	let bundleBusy = $state(false);
	let bundleStatus: { msg: string; kind: 'ok' | 'err' } | null = $state(null);

	function flash(msg: string, kind: 'ok' | 'err' = 'ok') {
		bundleStatus = { msg, kind };
		setTimeout(() => {
			bundleStatus = null;
		}, BUNDLE_FLASH_MS);
	}

	async function doExport() {
		if (bundleBusy) return;
		bundleBusy = true;
		try {
			const bundle = await exportSettings();
			const picked = await saveDialog({
				defaultPath: 'pandia-settings.json',
				filters: [{ name: 'JSON', extensions: ['json'] }],
			});
			if (typeof picked !== 'string') return;
			const text = JSON.stringify(bundle, null, 2);
			await writeFile(picked, new TextEncoder().encode(text));
			flash('settings exported');
		} catch (e) {
			flash(String(e), 'err');
		} finally {
			bundleBusy = false;
		}
	}

	async function doImport() {
		if (bundleBusy) return;
		bundleBusy = true;
		try {
			const picked = await openDialog({
				multiple: false,
				directory: false,
				filters: [{ name: 'JSON', extensions: ['json'] }],
			});
			if (typeof picked !== 'string') return;
			const text = await readTextFile(picked);
			let raw: unknown;
			try {
				raw = JSON.parse(text);
			} catch {
				flash('selected file is not valid JSON', 'err');
				return;
			}
			await importSettings(raw);
			await Promise.all([
				appearancePrefs.reload(),
				behaviorPrefs.reload(),
				sidebarPrefs.reload(),
				typegenPrefs.reload(),
			]);
			flash('settings imported');
		} catch (e) {
			flash(String(e), 'err');
		} finally {
			bundleBusy = false;
		}
	}
</script>

<div class="settings-panel">
	<header class="settings-head">
		<h2 class="settings-title">Data</h2>
		<p class="text-sm dim">Local storage management. All data stays on this machine.</p>
	</header>

	<section class="field">
		<div class="field-label">backup</div>
		<div class="field-control">
			<div class="btn-row">
				<button class="btn" onclick={doExport} disabled={bundleBusy}>
					Export settings…
				</button>
				<button class="btn" onclick={doImport} disabled={bundleBusy}>
					Import settings…
				</button>
			</div>
			<div class="text-sm dim">
				Save / restore preferences (appearance, behavior, layout, type-generation language) as
				one JSON file. Per-document state — recents, grid widths, command-usage counts — is not
				included.
			</div>
			{#if bundleStatus}
				<div class="text-sm" class:dim={bundleStatus.kind === 'ok'} class:err={bundleStatus.kind === 'err'}>
					{bundleStatus.msg}
				</div>
			{/if}
		</div>
	</section>

	<section class="field">
		<div class="field-label">recent files</div>
		<div class="field-control">
			<button
				class="btn self-start"
				class:btn-danger={armed === 'recents'}
				onclick={() => arm('recents', clearRecents)}
				disabled={recentsStore.list.length === 0}
				>{armed === 'recents'
					? 'click again to confirm'
					: `clear ${recentsStore.list.length} recent file${recentsStore.list.length === 1 ? '' : 's'}`}</button
			>
			<div class="text-sm dim">
				Forgets the recent-files list shown on the empty state. Files on disk are untouched.
			</div>
		</div>
	</section>

	<section class="field">
		<div class="field-label">appearance</div>
		<div class="field-control">
			<button class="btn self-start" onclick={() => appearancePrefs.reset()}
				>restore appearance defaults</button
			>
			<div class="text-sm dim">
				Resets theme, font, size, and density to terminal-noir defaults.
			</div>
		</div>
	</section>

	<section class="field">
		<div class="field-label">storage</div>
		<div class="field-control">
			<div class="text-sm dim">
				All settings + data live in plugin-store files under the OS app-data directory. Nothing
				leaves this machine.
			</div>
			<ul class="file-list">
				{#each PERSISTED_FILES as f (f)}
					<li>{f}</li>
				{/each}
			</ul>
		</div>
	</section>
</div>

<style>
	.file-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		color: var(--text-faint);
	}
	.btn-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.err {
		color: var(--danger);
	}
</style>
