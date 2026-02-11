<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		visible?: boolean;
		title: string;
		subtitle?: string;
		icon?: string;
		width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
		showFooter?: boolean;
		onclose?: () => void;
		children?: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let {
		visible = $bindable(false),
		title,
		subtitle = '',
		icon = '',
		width = 'md',
		showFooter = true,
		onclose,
		children,
		footer
	}: Props = $props();

	let modalContainer: HTMLElement | null = $state(null);
	let previouslyFocused: HTMLElement | null = null;

	function close() {
		visible = false;
		if (previouslyFocused && previouslyFocused.focus) {
			previouslyFocused.focus();
		}
		onclose?.();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}

		if (event.key === 'Tab' && modalContainer) {
			const focusableElements = modalContainer.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			const focusable = Array.from(focusableElements).filter(el => !el.hasAttribute('disabled'));

			if (focusable.length === 0) return;

			const firstFocusable = focusable[0];
			const lastFocusable = focusable[focusable.length - 1];

			if (event.shiftKey && document.activeElement === firstFocusable) {
				event.preventDefault();
				lastFocusable.focus();
			} else if (!event.shiftKey && document.activeElement === lastFocusable) {
				event.preventDefault();
				firstFocusable.focus();
			}
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function focusFirstElement() {
		if (!modalContainer) return;

		const focusableElements = modalContainer.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		const focusable = Array.from(focusableElements).filter(el => !el.hasAttribute('disabled'));

		if (focusable.length > 0) {
			const closeBtn = modalContainer.querySelector<HTMLElement>('.close-btn');
			if (closeBtn) {
				closeBtn.focus();
			} else {
				focusable[0].focus();
			}
		} else {
			modalContainer.focus();
		}
	}

	onMount(() => {
		if (visible) {
			previouslyFocused = document.activeElement as HTMLElement;
			focusFirstElement();
		}
	});

	onDestroy(() => {
		if (visible && previouslyFocused && previouslyFocused.focus) {
			previouslyFocused.focus();
		}
	});

	$effect(() => {
		if (visible) {
			previouslyFocused = document.activeElement as HTMLElement;
			const timer = setTimeout(() => focusFirstElement(), 0);
			return () => clearTimeout(timer);
		}
	});

	const widthClasses: Record<string, string> = {
		sm: 'max-width-sm',
		md: 'max-width-md',
		lg: 'max-width-lg',
		xl: 'max-width-xl',
		full: 'max-width-full'
	};
</script>

{#if visible}
	<div
		class="modal-overlay"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
		tabindex="-1"
	>
		<section
			bind:this={modalContainer}
			class="modal-container {widthClasses[width]}"
			aria-labelledby="modal-title"
		>
			<div class="modal-header">
				<div class="header-title">
					{#if icon}
						<div class="icon-wrapper">
							<Icon name={icon} size={20} />
						</div>
					{/if}
					<div class="title-text">
						<h2 id="modal-title">{title}</h2>
						{#if subtitle}
							<p class="subtitle">{subtitle}</p>
						{/if}
					</div>
				</div>
				<button class="close-btn" onclick={close} aria-label="Close modal">
					<Icon name="close" size={20} />
				</button>
			</div>

			<div class="modal-content">
				{@render children?.()}
			</div>

			{#if showFooter && footer}
				<div class="modal-footer">
					{@render footer()}
				</div>
			{/if}
		</section>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1200;
		backdrop-filter: blur(4px);
	}

	.modal-container {
		background: var(--color-surface);
		border-radius: var(--border-radius-lg);
		width: 90%;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border);
		overflow: hidden;
		animation: modalSlideIn 0.2s ease-out;
	}

	.modal-container:focus {
		outline: none;
	}

	.max-width-sm { max-width: 480px; }
	.max-width-md { max-width: 640px; }
	.max-width-lg { max-width: 800px; }
	.max-width-xl { max-width: 1000px; }
	.max-width-full { max-width: 95vw; }

	@keyframes modalSlideIn {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		padding: var(--spacing-md) var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--color-surface-secondary);
		flex-shrink: 0;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
	}

	.icon-wrapper {
		width: 40px;
		height: 40px;
		border-radius: var(--border-radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
		border: 1px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.2);
	}

	.title-text h2 {
		margin: 0;
		color: var(--color-text);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.subtitle {
		margin: 2px 0 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: var(--spacing-xs);
		border-radius: var(--border-radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.modal-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.modal-footer {
		padding: var(--spacing-md) var(--spacing-lg);
		border-top: 1px solid var(--color-border);
		background: var(--color-surface-secondary);
		flex-shrink: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-container {
			animation: none;
		}
	}
</style>
