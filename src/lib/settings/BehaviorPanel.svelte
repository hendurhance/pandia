<script lang="ts">
	import {
		behaviorPrefs,
		SCHEMA_DEBOUNCE_IMMEDIATE,
		SCHEMA_DEBOUNCE_MANUAL,
	} from './state/behavior-prefs.svelte';

	$effect(() => {
		void behaviorPrefs.init();
	});

	const DEBOUNCE_PRESETS: Array<{ label: string; value: number; hint: string }> = [
		{ label: 'Manual', value: SCHEMA_DEBOUNCE_MANUAL, hint: 'Validate only when asked' },
		{ label: 'Immediate', value: SCHEMA_DEBOUNCE_IMMEDIATE, hint: 'On every edit' },
		{ label: '250 ms', value: 250, hint: 'Snappy' },
		{ label: '500 ms', value: 500, hint: 'Default' },
		{ label: '1 s', value: 1000, hint: 'Relaxed' },
		{ label: '2 s', value: 2000, hint: 'Heavy schemas' },
	];

	const activeDebounce = $derived(behaviorPrefs.schemaDebounceMs);

	const AUTO_SAVE_PRESETS: Array<{ label: string; value: number; hint: string }> = [
		{ label: '500 ms', value: 500, hint: 'aggressive' },
		{ label: '1 s', value: 1000, hint: 'snappy' },
		{ label: '1.5 s', value: 1500, hint: 'default' },
		{ label: '3 s', value: 3000, hint: 'relaxed' },
	];
</script>

<div class="settings-panel">
	<header class="settings-head">
		<h2 class="settings-title">Behavior</h2>
		<p class="text-sm dim">How tooling reacts to edits. Persisted across launches.</p>
	</header>

	<section class="field">
		<div class="field-label">schema validation</div>
		<div class="field-control">
			<div class="seg">
				{#each DEBOUNCE_PRESETS as p (p.value)}
					<button
						class:active={activeDebounce === p.value}
						onclick={() => behaviorPrefs.setSchemaDebounce(p.value)}
						title={p.hint}>{p.label}</button
					>
				{/each}
			</div>
			<div class="text-sm dim">
				{#if activeDebounce === SCHEMA_DEBOUNCE_MANUAL}
					Schema panel validates only when you press <span class="kbd">validate</span>.
				{:else if activeDebounce === SCHEMA_DEBOUNCE_IMMEDIATE}
					Validates on every document edit — best for small schemas / fast machines.
				{:else}
					Re-validates {activeDebounce} ms after you stop editing.
				{/if}
			</div>
		</div>
	</section>

	<section class="field">
		<div class="field-label">large file warning</div>
		<div class="field-control">
			<button
				class="switch"
				role="switch"
				aria-checked={behaviorPrefs.warnLargeFileOpen}
				onclick={() => behaviorPrefs.setWarnLargeFileOpen(!behaviorPrefs.warnLargeFileOpen)}
			>
				<span class="switch-knob"></span>
				<span class="switch-text">{behaviorPrefs.warnLargeFileOpen ? 'on' : 'off'}</span>
			</button>
			<div class="text-sm dim">
				Confirm before opening files larger than 200 MB. Validation, diff, and export can be slow at
				that size.
			</div>
		</div>
	</section>

	<section class="field">
		<div class="field-label">auto-repair</div>
		<div class="field-control">
			<button
				class="switch"
				role="switch"
				aria-checked={behaviorPrefs.autoRepairOnPaste}
				onclick={() => behaviorPrefs.setAutoRepairOnPaste(!behaviorPrefs.autoRepairOnPaste)}
			>
				<span class="switch-knob"></span>
				<span class="switch-text">{behaviorPrefs.autoRepairOnPaste ? 'on' : 'off'}</span>
			</button>
			<div class="text-sm dim">
				When a pasted/opened document fails to parse, attempt JSON repair (trailing commas,
				unterminated strings, comments, …) before showing an error.
			</div>
		</div>
	</section>

	<section class="field">
		<div class="field-label">auto-save</div>
		<div class="field-control">
			<button
				class="switch"
				role="switch"
				aria-checked={behaviorPrefs.autoSaveOnIdle}
				onclick={() => behaviorPrefs.setAutoSaveOnIdle(!behaviorPrefs.autoSaveOnIdle)}
			>
				<span class="switch-knob"></span>
				<span class="switch-text">{behaviorPrefs.autoSaveOnIdle ? 'on' : 'off'}</span>
			</button>
			<div class="text-sm dim">
				Save file-backed documents automatically after a brief pause in typing. When off, ⌘S saves
				manually and closing an unsaved tab prompts to save.
			</div>
			{#if behaviorPrefs.autoSaveOnIdle}
				<div class="seg">
					{#each AUTO_SAVE_PRESETS as p (p.value)}
						<button
							class:active={behaviorPrefs.autoSaveIdleMs === p.value}
							onclick={() => behaviorPrefs.setAutoSaveIdleMs(p.value)}
							title={p.hint}>{p.label}</button
						>
					{/each}
				</div>
				<div class="text-sm dim">
					Saves {behaviorPrefs.autoSaveIdleMs} ms after you stop editing.
				</div>
			{/if}
		</div>
	</section>
</div>
