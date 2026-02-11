<script lang="ts">
	import { onMount } from 'svelte';
	import { snippetService, SNIPPET_CATEGORIES, type Snippet, type SnippetCategory } from '$lib/services/snippet';
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';

	interface Props {
		visible?: boolean;
		onclose?: () => void;
		onnotification?: (event: { type: string; message: string }) => void;
		oninsertSnippet?: (content: string) => void;
	}

	let { visible = $bindable(false), onclose, onnotification, oninsertSnippet }: Props = $props();

	let snippets: Snippet[] = $state([]);
	let filteredSnippets: Snippet[] = $state([]);
	let searchQuery = $state('');
	let selectedCategory: SnippetCategory = $state('all');
	let selectedSnippet: Snippet | null = $state(null);
	let isEditing = $state(false);
	let isCreating = $state(false);

	let editForm = $state({
		name: '',
		description: '',
		content: '',
		category: '',
		tags: ''
	});

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}

	onMount(() => {
		snippets = snippetService.init();
		filterSnippets();
	});

	$effect(() => {
		if (visible) {
			filterSnippets();
		}
	});

	$effect(() => {
		searchQuery;
		selectedCategory;
		filterSnippets();
	});

	function filterSnippets() {
		filteredSnippets = snippetService.filter(searchQuery, selectedCategory);
	}

	function selectSnippet(snippet: Snippet) {
		selectedSnippet = snippet;
		isEditing = false;
		isCreating = false;
	}

	function startEditing() {
		if (!selectedSnippet) return;

		editForm = {
			name: selectedSnippet.name,
			description: selectedSnippet.description,
			content: selectedSnippet.content,
			category: selectedSnippet.category,
			tags: selectedSnippet.tags.join(', ')
		};
		isEditing = true;
		isCreating = false;
	}

	function startCreating() {
		editForm = {
			name: '',
			description: '',
			content: '{}',
			category: 'template',
			tags: ''
		};
		isCreating = true;
		isEditing = false;
		selectedSnippet = null;
	}

	function cancelEdit() {
		isEditing = false;
		isCreating = false;
		editForm = { name: '', description: '', content: '', category: '', tags: '' };
	}

	function saveSnippet() {
		if (!editForm.name.trim()) return;

		const tags = editForm.tags.split(',').map(tag => tag.trim()).filter(tag => tag);

		if (isCreating) {
			const newSnippet = snippetService.create({
				name: editForm.name.trim(),
				description: editForm.description.trim(),
				content: editForm.content,
				category: editForm.category,
				tags
			});
			snippets = snippetService.getAll();
			selectedSnippet = newSnippet;
		} else if (selectedSnippet && isEditing) {
			const updated = snippetService.update(selectedSnippet.id, {
				name: editForm.name.trim(),
				description: editForm.description.trim(),
				content: editForm.content,
				category: editForm.category,
				tags
			});
			if (updated) {
				snippets = snippetService.getAll();
				selectedSnippet = updated;
			}
		}

		filterSnippets();
		isEditing = false;
		isCreating = false;
	}

	function deleteSnippet(snippet: Snippet) {
		if (snippetService.isBuiltIn(snippet.id)) {
			onnotification?.({ type: 'warning', message: 'Cannot delete built-in snippets' });
			return;
		}

		if (confirm(`Are you sure you want to delete "${snippet.name}"?`)) {
			snippetService.delete(snippet.id);
			snippets = snippetService.getAll();
			if (selectedSnippet?.id === snippet.id) {
				selectedSnippet = null;
			}
			filterSnippets();
		}
	}

	function insertSnippet(snippet: Snippet) {
		oninsertSnippet?.(snippet.content);
		close();
	}

	function duplicateSnippet(snippet: Snippet) {
		const duplicate = snippetService.duplicate(snippet);
		snippets = snippetService.getAll();
		filterSnippets();
		selectedSnippet = duplicate;
	}

	function exportSnippets() {
		snippetService.exportAsFile();
	}

	async function importSnippets(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const result = await snippetService.importFromFile(file);
		if (result.imported > 0) {
			snippets = snippetService.getAll();
			filterSnippets();
			onnotification?.({ type: 'success', message: `Imported ${result.imported} snippets` });
		}
		if (result.errors.length > 0) {
			onnotification?.({ type: 'error', message: result.errors[0] });
		}
		input.value = '';
	}

	function close() {
		visible = false;
		selectedSnippet = null;
		isEditing = false;
		isCreating = false;
		searchQuery = '';
		selectedCategory = 'all';
		onclose?.();
	}
</script>

{#if visible}
	<div
		class="modal-overlay"
		onclick={(e) => e.target === e.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-modal="true"
		aria-label="Snippet Manager"
		tabindex="-1"
	>
		<section class="snippet-modal" aria-label="Snippet Manager Dialog">
			<div class="sidebar">
				<div class="sidebar-header">
					<div class="header-top">
						<h2>Snippets</h2>
						<button class="btn-icon" onclick={close} title="Close">
							<Icon name="close" size={16} />
						</button>
					</div>

					<div class="search-box">
						<Icon name="search" size={14} class="search-icon" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search snippets..."
							class="search-input"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
						/>
					</div>

					<div class="category-filters">
						{#each SNIPPET_CATEGORIES as category}
							<button
								class="category-pill {selectedCategory === category ? 'active' : ''}"
								onclick={() => selectedCategory = category}
							>
								{category.charAt(0).toUpperCase() + category.slice(1)}
							</button>
						{/each}
					</div>
				</div>

				<div class="snippets-list">
					{#each filteredSnippets as snippet}
						<div
							class="snippet-item {snippet.id === selectedSnippet?.id ? 'selected' : ''}"
							onclick={() => selectSnippet(snippet)}
							role="button"
							tabindex="0"
							onkeydown={(e) => e.key === 'Enter' && selectSnippet(snippet)}
						>
							<div class="snippet-item-header">
								<span class="snippet-name">{snippet.name}</span>
								{#if snippetService.isBuiltIn(snippet.id)}
									<Icon name="lock" size={12} class="lock-icon" />
								{/if}
							</div>
							<p class="snippet-desc">{snippet.description}</p>
							<div class="snippet-tags">
								<span class="category-badge">{snippet.category}</span>
								{#each snippet.tags.slice(0, 2) as tag}
									<span class="tag-badge">{tag}</span>
								{/each}
								{#if snippet.tags.length > 2}
									<span class="tag-badge">+{snippet.tags.length - 2}</span>
								{/if}
							</div>
						</div>
					{/each}

					{#if filteredSnippets.length === 0}
						<div class="empty-list">
							<p>No snippets found</p>
						</div>
					{/if}
				</div>

				<div class="sidebar-footer">
					<div class="footer-actions">
						<label class="btn-icon-text" title="Import snippets">
							<Icon name="import" size={14} />
							<span>Import</span>
							<input
								type="file"
								accept=".json"
								onchange={importSnippets}
								style="display: none;"
							/>
						</label>
						<button class="btn-icon-text" onclick={exportSnippets} title="Export snippets">
							<Icon name="export" size={14} />
							<span>Export</span>
						</button>
					</div>
					<button class="btn-primary create-btn" onclick={startCreating}>
						<Icon name="plus" size={14} /> New Snippet
					</button>
				</div>
			</div>

			<div class="main-content">
				{#if isEditing || isCreating}
					<div class="editor-view">
						<div class="view-header">
							<h3>{isCreating ? 'Create New Snippet' : 'Edit Snippet'}</h3>
							<div class="header-actions">
								<button class="btn-secondary" onclick={cancelEdit}>Cancel</button>
								<button class="btn-primary" onclick={saveSnippet}>
									<Icon name="file-save" size={14} /> Save
								</button>
							</div>
						</div>

						<div class="form-container">
							<div class="form-group">
								<label for="snippet-name">Name</label>
								<input
									id="snippet-name"
									type="text"
									bind:value={editForm.name}
									class="form-input"
									placeholder="e.g., User Profile Template"
									autocomplete="off"
									autocapitalize="off"
								/>
							</div>

							<div class="form-group">
								<label for="snippet-desc">Description</label>
								<input
									id="snippet-desc"
									type="text"
									bind:value={editForm.description}
									class="form-input"
									placeholder="What does this snippet do?"
									autocomplete="off"
									autocapitalize="off"
								/>
							</div>

							<div class="form-row">
								<div class="form-group">
									<label for="snippet-cat">Category</label>
									<select id="snippet-cat" bind:value={editForm.category} class="form-select">
										{#each SNIPPET_CATEGORIES.slice(1) as category}
											<option value={category}>
												{category.charAt(0).toUpperCase() + category.slice(1)}
											</option>
										{/each}
									</select>
								</div>

								<div class="form-group">
									<label for="snippet-tags">Tags</label>
									<input
										id="snippet-tags"
										type="text"
										bind:value={editForm.tags}
										class="form-input"
										placeholder="comma, separated, tags"
										autocomplete="off"
										autocapitalize="off"
									/>
								</div>
							</div>

							<div class="form-group full-height">
								<label for="snippet-content">Content (JSON)</label>
								<textarea
									id="snippet-content"
									bind:value={editForm.content}
									class="code-editor"
									placeholder={'{}'}
									spellcheck="false"
								></textarea>
							</div>
						</div>
					</div>
				{:else if selectedSnippet}
					{@const snippet = selectedSnippet}
					<div class="detail-view">
						<div class="view-header">
							<div class="title-section">
								<h2>{snippet.name}</h2>
								<div class="meta-badges">
									<span class="category-pill active">{snippet.category}</span>
									<span class="date-badge">Updated {formatDate(snippet.updatedAt)}</span>
								</div>
							</div>
							<div class="header-actions">
								{#if !snippetService.isBuiltIn(snippet.id)}
									<button class="btn-icon" onclick={() => deleteSnippet(snippet)} title="Delete">
										<Icon name="trash" size={16} />
									</button>
									<button class="btn-secondary" onclick={startEditing}>
										<Icon name="edit" size={14} /> Edit
									</button>
								{/if}
								<button class="btn-secondary" onclick={() => duplicateSnippet(snippet)}>
									<Icon name="file-new" size={14} /> Duplicate
								</button>
								<button class="btn-primary" onclick={() => insertSnippet(snippet)}>
									<Icon name="clipboard" size={14} /> Insert
								</button>
							</div>
						</div>

						<div class="snippet-info">
							<p class="description">{snippet.description}</p>
							{#if snippet.tags.length > 0}
								<div class="tags-list">
									{#each snippet.tags as tag}
										<span class="tag-pill">#{tag}</span>
									{/each}
								</div>
							{/if}
						</div>

						<div class="code-preview-container">
							<div class="preview-header">
								<span>JSON Preview</span>
							</div>
							<div class="code-preview-wrapper">
								<CodeBlock
									code={snippet.content}
									language="json"
									showLineNumbers={false}
								/>
							</div>
						</div>
					</div>
				{:else}
					<div class="empty-state">
						<div class="empty-icon">
							<Icon name="code" size={64} />
						</div>
						<h3>Select a Snippet</h3>
						<p>Choose a snippet from the sidebar to view details or insert it into your editor.</p>
						<button class="btn-primary" onclick={startCreating}>
							<Icon name="plus" size={14} /> Create New Snippet
						</button>
					</div>
				{/if}
			</div>
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
		background: rgba(0, 0, 0, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

	.snippet-modal {
		background: var(--color-surface);
		border-radius: 12px;
		width: 90%;
		max-width: 1100px;
		height: 85vh;
		display: flex;
		box-shadow: var(--shadow-xl);
		border: 1px solid var(--color-border);
		overflow: hidden;
	}

	.sidebar {
		width: 320px;
		background: var(--color-background-secondary);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	.sidebar-header {
		padding: 16px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.header-top h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text);
	}

	.search-box {
		position: relative;
		width: 100%;
	}

	:global(.search-icon) {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px 8px 32px;
		background: var(--color-surface-secondary);
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--color-text);
		font-size: 13px;
		transition: all 0.2s;
	}

	.search-input:focus {
		outline: none;
		background: var(--color-surface-hover);
		border-color: var(--color-primary);
	}

	.category-filters {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 4px;
		scrollbar-width: none;
	}

	.category-filters::-webkit-scrollbar {
		display: none;
	}

	.category-pill {
		background: var(--color-surface-secondary);
		border: none;
		color: var(--color-text-secondary);
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.2s;
	}

	.category-pill:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.category-pill.active {
		background: var(--color-primary);
		color: #fff;
	}

	.snippets-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.snippet-item {
		padding: 10px 12px;
		border-radius: 6px;
		cursor: pointer;
		margin-bottom: 4px;
		border: 1px solid transparent;
		transition: all 0.2s;
	}

	.snippet-item:hover {
		background: var(--color-surface-hover);
	}

	.snippet-item.selected {
		background: var(--color-surface-secondary);
		border-color: var(--color-primary);
	}

	.snippet-item-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.snippet-name {
		font-weight: 500;
		color: var(--color-text);
		font-size: 13px;
	}

	:global(.lock-icon) {
		color: var(--color-text-muted);
	}

	.snippet-desc {
		margin: 0 0 8px 0;
		font-size: 11px;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.snippet-tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.category-badge {
		font-size: 10px;
		color: var(--color-primary);
		background: rgba(79, 193, 255, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.tag-badge {
		font-size: 10px;
		color: var(--color-text-muted);
		background: var(--color-surface-secondary);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.empty-list {
		padding: 20px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.sidebar-footer {
		padding: 12px 16px;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--color-background-secondary);
	}

	.footer-actions {
		display: flex;
		gap: 8px;
	}

	.btn-icon-text {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px;
		background: var(--color-surface-secondary);
		border: none;
		border-radius: 4px;
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-icon-text:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.create-btn {
		width: 100%;
		justify-content: center;
	}

	.main-content {
		flex: 1;
		background: var(--color-surface);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.view-header {
		padding: 20px 24px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		background: var(--color-surface);
	}

	.title-section h2 {
		margin: 0 0 8px 0;
		font-size: 20px;
		color: var(--color-text);
	}

	.meta-badges {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.date-badge {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.header-actions {
		display: flex;
		gap: 8px;
	}

	.snippet-info {
		padding: 20px 24px;
	}

	.description {
		color: var(--color-text-secondary);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 12px 0;
	}

	.tags-list {
		display: flex;
		gap: 6px;
	}

	.tag-pill {
		color: var(--color-text-muted);
		font-size: 12px;
		background: var(--color-surface-secondary);
		padding: 2px 8px;
		border-radius: 12px;
	}

	.detail-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.detail-view .view-header {
		flex-shrink: 0;
	}

	.detail-view .snippet-info {
		flex-shrink: 0;
	}

	.code-preview-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		margin: 0 24px 24px 24px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
		background: var(--color-surface);
		min-height: 0;
	}

	.preview-header {
		padding: 8px 12px;
		background: var(--color-background-secondary);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.code-preview-wrapper {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.code-preview-wrapper :global(.code-block) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border: none;
		border-radius: 0;
	}

	.code-preview-wrapper :global(.code-container) {
		flex: 1;
		min-height: 0;
	}

	.editor-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.form-container {
		padding: 24px;
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-group.full-height {
		flex: 1;
		min-height: 200px;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.form-input, .form-select {
		padding: 8px 12px;
		background: var(--color-background-secondary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text);
		font-size: 13px;
	}

	.form-input:focus, .form-select:focus, .code-editor:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.code-editor {
		flex: 1;
		padding: 12px;
		background: var(--color-background-secondary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text);
		font-family: 'Consolas', 'Monaco', monospace;
		font-size: 13px;
		line-height: 1.5;
		resize: none;
	}

	.empty-state {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		text-align: center;
		padding: 40px;
	}

	.empty-icon {
		margin-bottom: 16px;
		opacity: 0.5;
	}

	.empty-state h3 {
		margin: 0 0 8px 0;
		color: var(--color-text-secondary);
		font-size: 18px;
	}

	.empty-state p {
		margin: 0 0 24px 0;
		max-width: 300px;
		font-size: 14px;
	}

	.btn-primary, .btn-secondary, .btn-icon {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 4px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}

	.btn-primary {
		background: var(--color-primary);
		color: #fff;
	}

	.btn-primary:hover {
		background: var(--color-primary-hover);
	}

	.btn-secondary {
		background: var(--color-surface-secondary);
		color: var(--color-text-secondary);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.btn-icon {
		padding: 6px;
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn-icon:hover {
		background: var(--color-surface-secondary);
		color: var(--color-text);
	}
</style>
