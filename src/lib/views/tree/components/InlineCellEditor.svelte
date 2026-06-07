<script lang="ts">
	import type { ContentRow } from '../logic/model';
	import { autofocusSelect, autogrowArea, autofocusEl } from '$lib/ui/focus';
	import Icon from '$lib/ui/Icon.svelte';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import {
		createEditHandlers,
		editSize,
		nextNumberValue,
		valueTypeLabel,
	} from '../logic/edit-handlers';

	let {
		buffer,
		field,
		kind,
		onInput,
		onCommit,
		onCancel,
	}: {
		buffer: string;
		field: 'key' | 'value';
		kind: ContentRow['kind'];
		onInput: (value: string) => void;
		onCommit: () => void;
		onCancel: () => void;
	} = $props();

	const {
		onAreaKeydown,
		commitBool,
		onBoolFocusOut,
		onBoolKeydown,
		onNumberKeydown,
		onEditKeydown,
	} = createEditHandlers({
		onCommit: () => onCommit(),
		onCancel: () => onCancel(),
		onInput: (v) => onInput(v),
		buffer: () => buffer,
	});
</script>

{#snippet microBar(label: string, saveKey: string)}
	<span class="micro-bar">
		<span class="slot type">{label}</span>
		<button
			class="slot commit"
			onmousedown={(e) => {
				e.preventDefault();
				onCommit();
			}}>{saveKey} Save</button
		>
		<button
			class="slot cancel"
			onmousedown={(e) => {
				e.preventDefault();
				onCancel();
			}}>Esc</button
		>
	</span>
{/snippet}

{#if field === 'key'}
	<input
		class="edit-input k-input"
		value={buffer}
		size={editSize(buffer)}
		use:autofocusSelect
		oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
		onkeydown={onEditKeydown}
		onblur={onCommit}
		spellcheck="false"
		autocomplete="off"
	/>
	{@render microBar('Key', '⏎')}
{:else if kind === 'bool'}
	<span
		class="bool-seg"
		use:autofocusEl
		onkeydown={onBoolKeydown}
		onfocusout={onBoolFocusOut}
		role="radiogroup"
		tabindex="0"
		aria-label="boolean value"
	>
		<button
			class="opt"
			class:active={buffer === 'true'}
			onmousedown={(e) => {
				e.preventDefault();
				commitBool('true');
			}}>true</button
		>
		<button
			class="opt"
			class:active={buffer === 'false'}
			onmousedown={(e) => {
				e.preventDefault();
				commitBool('false');
			}}>false</button
		>
	</span>
	<span class="edit-hint">←/→ toggle · ⏎ save</span>
{:else if kind === 'number'}
	<span class="num-edit">
		<input
			class="edit-input v-input number num-input"
			value={buffer}
			size={editSize(buffer)}
			use:autofocusSelect
			oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
			onkeydown={onNumberKeydown}
			onblur={onCommit}
			spellcheck="false"
			autocomplete="off"
		/>
		<span class="step">
			<button
				class="arrow"
				onmousedown={(e) => {
					e.preventDefault();
					onInput(nextNumberValue(buffer, e.shiftKey ? 10 : 1));
				}}><Icon icon={ChevronUp} size="xs" /></button
			>
			<button
				class="arrow"
				onmousedown={(e) => {
					e.preventDefault();
					onInput(nextNumberValue(buffer, e.shiftKey ? -10 : -1));
				}}><Icon icon={ChevronDown} size="xs" /></button
			>
		</span>
	</span>
	<span class="edit-hint">↑/↓ step · ⇧ ×10</span>
{:else if kind === 'string'}
	<span class="str-edit">
		<textarea
			class="edit-area"
			value={buffer}
			use:autogrowArea
			oninput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
			onkeydown={onAreaKeydown}
			onblur={onCommit}
			spellcheck="false"
		></textarea>
		{@render microBar('Str', '⌘⏎')}
	</span>
{:else}
	<input
		class="edit-input v-input {kind}"
		value={buffer}
		size={editSize(buffer)}
		use:autofocusSelect
		oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
		onkeydown={onEditKeydown}
		onblur={onCommit}
		spellcheck="false"
		autocomplete="off"
	/>
	{@render microBar(valueTypeLabel(kind), '⏎')}
{/if}

<style>
	.edit-input {
		font: inherit;
		font-size: 13px;
		background: var(--bg-edit);
		color: var(--text);
		border: none;
		border-bottom: 1px solid var(--accent);
		padding: 0 0.3rem;
		outline: none;
		flex-shrink: 0;
		width: auto;
		caret-color: var(--accent);
	}
	.edit-input.k-input {
		color: var(--text);
	}
	.edit-input.v-input.string {
		color: var(--syntax-string);
	}
	.edit-input.v-input.number {
		color: var(--syntax-number);
	}
	.edit-input.v-input.bool {
		color: var(--syntax-boolean);
	}
	.edit-input.v-input.null {
		color: var(--syntax-null);
		font-style: italic;
	}

	.str-edit {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
	}
	.edit-area {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		overflow: hidden;
		font: inherit;
		font-size: 13px;
		line-height: 18px;
		background: var(--bg-edit);
		color: var(--syntax-string);
		border: none;
		border-bottom: 1px solid var(--accent);
		padding: 1px 0.3rem;
		outline: none;
		caret-color: var(--accent);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.str-edit .micro-bar {
		margin-left: 0;
	}

	.micro-bar {
		display: inline-flex;
		align-items: stretch;
		height: 18px;
		background: var(--bg-elev-2);
		border: 1px solid var(--rule-2);
		margin-left: 4px;
		flex-shrink: 0;
	}
	.micro-bar .slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 8px;
		border: none;
		border-right: 1px solid var(--rule-2);
		background: transparent;
		color: var(--text-dim);
		font: inherit;
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
	}
	.micro-bar .slot:last-child {
		border-right: none;
	}
	.micro-bar .type {
		color: var(--accent);
		border-right: 1px solid var(--accent-line);
		cursor: default;
	}
	.micro-bar .commit {
		color: var(--accent);
	}
	.micro-bar .commit:hover {
		background: var(--accent);
		color: var(--bg);
	}
	.micro-bar .cancel {
		color: var(--text-faint);
	}
	.micro-bar .cancel:hover {
		color: var(--text);
		background: var(--bg-elev-3);
	}

	.bool-seg {
		display: inline-flex;
		align-items: stretch;
		height: 18px;
		background: var(--bg-edit);
		border-bottom: 1px solid var(--accent);
		flex-shrink: 0;
		outline: none;
	}
	.bool-seg .opt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		background: transparent;
		border: none;
		border-right: 1px solid var(--rule-2);
		color: var(--text-faint);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.bool-seg .opt:last-child {
		border-right: none;
	}
	.bool-seg .opt:hover:not(.active) {
		color: var(--text-dim);
	}
	.bool-seg .opt.active {
		background: var(--accent-fill);
		color: var(--syntax-boolean);
	}
	.bool-seg:focus-visible {
		box-shadow: 0 0 0 1px var(--accent-line);
	}

	.num-edit {
		display: inline-flex;
		align-items: stretch;
		background: var(--bg-edit);
		border-bottom: 1px solid var(--accent);
		flex-shrink: 0;
	}
	.num-edit .num-input {
		border-bottom: none;
		background: transparent;
	}
	.num-edit .step {
		display: inline-flex;
		flex-direction: column;
		border-left: 1px solid var(--rule-2);
		width: 16px;
	}
	.num-edit .step .arrow {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: 8px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.num-edit .step .arrow:hover {
		color: var(--accent);
		background: var(--bg-elev-3);
	}
	.num-edit .step .arrow + .arrow {
		border-top: 1px solid var(--rule-2);
	}

	.edit-hint {
		color: var(--text-faint);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		flex-shrink: 0;
		margin-left: 6px;
	}
</style>
