<script lang="ts">
	import { tabs } from '$lib/stores/tabs';
	import Icon from './Icon.svelte';

	async function handleFileImport() {
		try {
			// Try to use the file picker API if available (modern browsers)
			if ('showOpenFilePicker' in window) {
				const showOpenFilePicker = (window as any).showOpenFilePicker;
				const fileHandles = await showOpenFilePicker({
					multiple: true,
					types: [
						{
							description: 'JSON files',
							accept: { 'application/json': ['.json'] }
						},
						{
							description: 'Text files',
							accept: { 'text/plain': ['.txt', '.log', '.md'] }
						}
					]
				});

				for (const fileHandle of fileHandles) {
					const file = await fileHandle.getFile();
					const content = await file.text();
					await tabs.add({
						title: file.name,
						content,
						isDirty: false,
						isNew: false,
						filePath: fileHandle.name
					});
				}
			} else {
				// Fallback: create file input element
				const input = document.createElement('input');
				input.type = 'file';
				input.multiple = true;
				input.accept = '.json,.txt,.log,.md,text/*,application/json';
				
				input.onchange = async (e) => {
					const files = (e.target as HTMLInputElement).files;
					if (!files) return;

					for (const file of Array.from(files)) {
						const content = await file.text();
						await tabs.add({
							title: file.name,
							content,
							isDirty: false,
							isNew: false
						});
					}
				};

				input.click();
			}
		} catch (error) {
			console.error('Failed to import files:', error);
		}
	}

	function handleNewFile() {
		tabs.add({
			title: 'Untitled.json',
			content: '{\n  \n}',
			isDirty: true,
			isNew: true
		});
	}
</script>

<div class="empty-state">
	<div class="empty-content">
		<div class="empty-icon">
			<Icon name="file-open" size={48} />
		</div>
		
		<h2>No files open</h2>
		<p>Start by creating a new file or importing existing JSON files</p>
		
		<div class="empty-actions">
			<button class="btn btn-primary" onclick={handleNewFile}>
				<Icon name="file-new" size={16} />
				New File
			</button>
			
			<button class="btn btn-secondary" onclick={handleFileImport}>
				<Icon name="file-open" size={16} />
				Open Files
			</button>
		</div>
		
		<div class="empty-tips">
			<h3>Quick Tips:</h3>
			<ul>
				<li>Drag and drop files onto the editor to open them</li>
				<li>Use <kbd>Ctrl+N</kbd> (or <kbd>Cmd+N</kbd>) to create a new file</li>
				<li>Use <kbd>Ctrl+O</kbd> (or <kbd>Cmd+O</kbd>) to open files</li>
			</ul>
		</div>
	</div>
</div>

<style>
	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 400px;
		background: var(--color-surface);
		color: var(--color-text);
		padding: var(--spacing-xl);
	}

	.empty-content {
		text-align: center;
		max-width: 500px;
	}

	.empty-icon {
		margin-bottom: var(--spacing-lg);
		opacity: 0.3;
	}

	h2 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: var(--font-size-xl);
		font-weight: 600;
		color: var(--color-text);
	}

	p {
		margin: 0 0 var(--spacing-xl) 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-base);
		line-height: 1.5;
	}

	.empty-actions {
		display: flex;
		gap: var(--spacing-md);
		justify-content: center;
		margin-bottom: var(--spacing-xl);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-lg);
		border: none;
		border-radius: var(--border-radius-md);
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		text-decoration: none;
	}

	.btn-primary {
		background: var(--color-primary);
		color: white;
	}

	.btn-primary:hover {
		background: var(--color-primary-hover, #005a9e);
		transform: translateY(-1px);
	}

	.btn-secondary {
		background: var(--color-surface-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-border-hover);
		transform: translateY(-1px);
	}

	.empty-tips {
		text-align: left;
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-lg);
		margin-top: var(--spacing-xl);
	}

	.empty-tips h3 {
		margin: 0 0 var(--spacing-md) 0;
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text);
	}

	.empty-tips ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.empty-tips li {
		margin-bottom: var(--spacing-xs);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.4;
		position: relative;
		padding-left: var(--spacing-md);
	}

	.empty-tips li::before {
		content: '•';
		position: absolute;
		left: 0;
		color: var(--color-primary);
		font-weight: bold;
	}

	kbd {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-sm);
		padding: 2px 6px;
		font-size: 0.85em;
		font-family: var(--font-mono);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	@media (max-width: 600px) {
		.empty-actions {
			flex-direction: column;
			align-items: center;
		}

		.btn {
			width: 200px;
		}

		.empty-tips {
			text-align: center;
		}

		.empty-tips ul {
			text-align: left;
			display: inline-block;
		}
	}
</style>