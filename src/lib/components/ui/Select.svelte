<script lang="ts">
	import Icon from './Icon.svelte';

	interface SelectOption {
		value: string;
		label: string;
		disabled?: boolean;
		disabledReason?: string;
	}

	interface Props {
		value?: string;
		options?: SelectOption[];
		placeholder?: string;
		disabled?: boolean;
		class_?: string;
		id?: string;
		name?: string;
		required?: boolean;
		labelledby?: string;
		onchange?: (value: string) => void;
	}

	let {
		value = $bindable(''),
		options = [],
		placeholder = 'Select...',
		disabled = false,
		class_: class_ = '',
		id = '',
		name = '',
		required = false,
		labelledby = '',
		onchange = undefined
	}: Props = $props();

	let isOpen = $state(false);
	let selectElement: HTMLDivElement;
	let selectButton: HTMLButtonElement;
	let dropdownStyle = $state('');

	function toggleOpen() {
		if (disabled) return;
		
		if (!isOpen && selectButton) {
			// Calculate position for dropdown
			const rect = selectButton.getBoundingClientRect();
			dropdownStyle = `top: ${rect.bottom}px; left: ${rect.left}px; width: ${rect.width}px;`;
		}
		
		isOpen = !isOpen;
	}

	function selectOption(option: SelectOption) {
		if (option.disabled) return;
		value = option.value;
		isOpen = false;
		onchange?.(value);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled) return;
		
		switch (event.key) {
			case 'Enter':
			case ' ':
				event.preventDefault();
				toggleOpen();
				break;
			case 'Escape':
				isOpen = false;
				break;
			case 'ArrowDown':
				event.preventDefault();
				if (!isOpen) {
					toggleOpen();
				} else {
					// Focus next option logic could be added here
				}
				break;
			case 'ArrowUp':
				event.preventDefault();
				// Focus previous option logic could be added here
				break;
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (selectElement && !selectElement.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	$effect(() => {
		if (typeof window !== 'undefined' && isOpen) {
			document.addEventListener('click', handleClickOutside);
			// Return cleanup function for Svelte 5 $effect
			return () => {
				document.removeEventListener('click', handleClickOutside);
			};
		}
	});

	const selectedOption = $derived(options.find(opt => opt.value === value));
</script>

<div 
	class="custom-select {class_}" 
	class:disabled 
	class:open={isOpen}
	bind:this={selectElement}
>
	<!-- Hidden native select for form submission -->
	<select 
		{value} 
		{disabled} 
		{id} 
		{name} 
		{required}
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
	>
		{#each options as option}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>

	<!-- Custom select button -->
	<button
		bind:this={selectButton}
		type="button"
		class="select-button"
		class:placeholder={!selectedOption}
		{disabled}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		aria-labelledby={labelledby || undefined}
		onclick={toggleOpen}
		onkeydown={handleKeydown}
	>
		<span class="select-value">
			{selectedOption ? selectedOption.label : placeholder}
		</span>
		<Icon name="chevron-down" size={16} class="select-icon {isOpen ? 'rotate' : ''}" />
	</button>

	<!-- Options dropdown -->
	{#if isOpen}
		<div 
			class="select-options" 
			style={dropdownStyle}
			role="listbox"
			aria-label="Options"
		>
			{#each options as option}
				<button
					type="button"
					class="select-option"
					class:selected={option.value === value}
					class:disabled={option.disabled}
					role="option"
					aria-selected={option.value === value}
					aria-disabled={option.disabled}
					title={option.disabled ? option.disabledReason : undefined}
					onclick={() => selectOption(option)}
				>
					{option.label}
					{#if option.disabled}
						<span class="disabled-hint">(disabled)</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.custom-select {
		position: relative;
		width: 100%;
		font-family: var(--font-sans);
	}

	.custom-select.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.select-button {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 36px;
	}

	.select-button:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-border-secondary);
	}

	.select-button:focus {
		outline: none;
		border-color: var(--color-border-focus);
		box-shadow: 0 0 0 3px rgba(0, 122, 204, 0.1);
	}

	.select-button:disabled {
		cursor: not-allowed;
		background: var(--color-surface-secondary);
		color: var(--color-text-muted);
	}

	.select-button.placeholder {
		color: var(--color-text-muted);
	}

	.custom-select.open .select-button {
		border-color: var(--color-border-focus);
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.select-value {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.select-icon) {
		flex-shrink: 0;
		color: var(--color-text-secondary);
		transition: transform 0.15s ease;
	}

	:global(.select-icon.rotate) {
		transform: rotate(180deg);
	}

	.select-options {
		position: fixed;
		z-index: 1002;
		background: var(--color-surface);
		border: 1px solid var(--color-border-focus);
		border-radius: var(--border-radius-sm);
		box-shadow: var(--shadow-lg);
		max-height: 200px;
		overflow-y: auto;
		animation: slideDown 0.15s ease;
		min-width: 120px;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.select-option {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-surface);
		border: none;
		color: var(--color-text);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease;
		display: block;
	}

	.select-option:hover {
		background: var(--color-surface-hover);
	}

	.select-option:focus {
		outline: none;
		background: var(--color-surface-hover);
	}

	.select-option.selected {
		background: var(--color-primary);
		color: var(--color-text-inverted);
	}

	.select-option.selected:hover {
		background: var(--color-primary-hover);
	}

	.select-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		color: var(--color-text-muted);
	}

	.select-option.disabled:hover {
		background: var(--color-surface);
	}

	.disabled-hint {
		font-size: 10px;
		margin-left: 4px;
		opacity: 0.7;
	}

	.select-options::-webkit-scrollbar {
		width: 6px;
	}

	.select-options::-webkit-scrollbar-track {
		background: var(--color-surface-secondary);
	}

	.select-options::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: var(--border-radius-sm);
	}

	.select-options::-webkit-scrollbar-thumb:hover {
		background: var(--color-border-secondary);
	}

	/* Responsive design */
	@media (max-width: 768px) {
		.select-button {
			padding: var(--spacing-xs) var(--spacing-sm);
			min-height: 32px;
			font-size: var(--font-size-xs);
		}

		.select-option {
			padding: var(--spacing-xs) var(--spacing-sm);
			font-size: var(--font-size-xs);
		}
	}

	/* High contrast mode support */
	@media (prefers-contrast: high) {
		.select-button {
			border: 2px solid var(--color-border);
		}

		.select-options {
			border: 2px solid var(--color-border-focus);
		}
	}

	/* Reduced motion support */
	@media (prefers-reduced-motion: reduce) {
		.select-options {
			animation: none;
		}

		:global(.select-icon) {
			transition: none;
		}

		.select-button {
			transition: none;
		}
	}
</style>