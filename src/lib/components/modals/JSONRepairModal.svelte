<script lang="ts">
	import { JSONRepair, type RepairResult } from '$lib/services/repair';
	import Icon from '../ui/Icon.svelte';
	import CodeBlock from '../ui/CodeBlock.svelte';
	import BaseModal from './BaseModal.svelte';
	import { BYTES } from '$lib/constants';

	interface Props {
		visible?: boolean;
		content?: string;
		onclose?: () => void;
		onapply?: (event: { repairedJSON: string }) => void;
	}

	let { visible = $bindable(false), content = '', onclose, onapply }: Props = $props();

	let repairResult: RepairResult | null = $state(null);
	let isRepairing = $state(false);
	let activeTab = $state('diff'); // 'diff', 'preview', 'issues'

	$effect(() => {
		if (visible && content) {
			activeTab = 'diff';

			if (JSONRepair.isEscaped(content)) {
				// Let user choose between unescape and full repair
			} else {
				performRepair();
			}
		}
	});

	async function performRepair() {
		if (!content) return;

		isRepairing = true;
		try {
			const delay = content.length > 500000 ? 500 : 100;
			await new Promise(resolve => setTimeout(resolve, delay));
			
			repairResult = JSONRepair.repair(content);

			if (repairResult && !repairResult.success) {
				activeTab = 'issues';
			}
		} catch (error) {
			repairResult = {
				success: false,
				repairedJSON: content,
				errors: [`Repair failed: ${error}`],
				warnings: [],
				originalLength: content.length,
				repairedLength: content.length,
				wasUnescaped: false,
				cleanedUp: false
			};
			activeTab = 'issues';
		} finally {
			isRepairing = false;
		}
	}

	async function performUnescapeOnly() {
		if (!content) return;

		isRepairing = true;
		try {
			const delay = content.length > 500000 ? 500 : 100;
			await new Promise(resolve => setTimeout(resolve, delay));
			
			const unescapeResult = JSONRepair.unescapeAndClean(content);
			
			repairResult = {
				success: unescapeResult.success,
				repairedJSON: unescapeResult.result,
				errors: unescapeResult.success ? [] : [unescapeResult.operations.find(op => op.includes('Parse failed') || op.includes('Fatal error')) || 'Unescape failed'],
				warnings: unescapeResult.operations.filter(op => !op.includes('Parse failed') && !op.includes('Fatal error')),
				originalLength: content.length,
				repairedLength: unescapeResult.result.length,
				wasUnescaped: unescapeResult.operations.some(op => op.includes('unescaping')),
				cleanedUp: unescapeResult.operations.some(op => op.includes('cleanup'))
			};
			
			if (!repairResult.success) {
				activeTab = 'issues';
			}
		} catch (error) {
			repairResult = {
				success: false,
				repairedJSON: content,
				errors: [`Unescape failed: ${error}`],
				warnings: [],
				originalLength: content.length,
				repairedLength: content.length,
				wasUnescaped: false,
				cleanedUp: false
			};
			activeTab = 'issues';
		} finally {
			isRepairing = false;
		}
	}

	function close() {
		visible = false;
		repairResult = null;
		onclose?.();
	}

	function applyRepair() {
		if (repairResult && (repairResult.success || repairResult.repairedJSON !== content)) {
			onapply?.({ repairedJSON: repairResult.repairedJSON });
			close();
		}
	}

	function getDiffLines(original: string, repaired: string) {
		const originalLines = original.split('\n');
		const repairedLines = repaired.split('\n');
		const maxLines = Math.max(originalLines.length, repairedLines.length);
		
		const diff = [];
		for (let i = 0; i < maxLines; i++) {
			const origLine = originalLines[i] || '';
			const repLine = repairedLines[i] || '';
			
			if (origLine !== repLine) {
				diff.push({
					lineNumber: i + 1,
					original: origLine,
					repaired: repLine,
					type: origLine === '' ? 'added' : repLine === '' ? 'removed' : 'modified'
				});
			}
		}
		return diff;
	}

	let diffLines = $derived.by(() => {
		const result = repairResult;
		if (!result) return [];
		return getDiffLines(content, result.repairedJSON);
	});
	
	let issueCount = $derived.by(() => {
		if (!repairResult) return 0;
		return repairResult.errors.length + repairResult.warnings.length;
	});
</script>

<BaseModal
	bind:visible
	title="JSON Repair"
	subtitle="Fix syntax errors and format JSON"
	icon="repair"
	width="lg"
	onclose={close}
>
	<div class="modal-body">
				{#if isRepairing}
					<div class="loading-state">
						<div class="spinner"></div>
						<h3>Repairing JSON...</h3>
						<p>
							{#if content.length > 1000000}
								Processing large file ({Math.round(content.length / BYTES.MB)}MB)
							{:else}
								Analyzing structure and fixing errors
							{/if}
						</p>
					</div>
				{:else if !repairResult && content && JSONRepair.isEscaped(content)}
					<div class="detection-state">
						<div class="detection-card">
							<div class="detection-icon">
								<Icon name="shield" size={32} />
							</div>
							<h3>Escaped JSON Detected</h3>
							<p>This content appears to be a string containing JSON (escape level: {JSONRepair.getEscapeLevel(content)}).</p>
							
							<div class="detection-actions">
								<button class="action-card" onclick={performUnescapeOnly}>
									<div class="action-icon">
										<Icon name="code" size={24} />
									</div>
									<div class="action-info">
										<h4>Unescape Only</h4>
										<p>Remove escape characters and clean up the string.</p>
									</div>
									<Icon name="chevron-right" size={16} />
								</button>
								
								<button class="action-card primary" onclick={performRepair}>
									<div class="action-icon">
										<Icon name="repair" size={24} />
									</div>
									<div class="action-info">
										<h4>Full Repair</h4>
										<p>Unescape, fix syntax errors, and format the JSON.</p>
									</div>
									<Icon name="chevron-right" size={16} />
								</button>
							</div>
							
							<div class="preview-box">
								<div class="preview-header">Preview</div>
								<CodeBlock
									code={content.substring(0, 200) + (content.length > 200 ? '...' : '')}
									language="json"
									showCopyButton={false}
								/>
							</div>
						</div>
					</div>
				{:else if repairResult}
					<div class="results-state">
						<div class="status-banner {repairResult.success ? 'success' : 'error'}">
							<div class="status-icon">
								<Icon name={repairResult.success ? 'success' : 'error'} size={24} />
							</div>
							<div class="status-info">
								<h3>{repairResult.success ? 'Repair Successful' : 'Repair Failed'}</h3>
								<p>{repairResult.success ? 'Your JSON has been fixed and formatted.' : 'We couldn\'t automatically fix all issues.'}</p>
							</div>
						</div>

						<div class="stats-grid">
							<div class="stat-item">
								<span class="stat-label">Original Size</span>
								<span class="stat-value">{repairResult.originalLength} chars</span>
							</div>
							<div class="stat-item">
								<span class="stat-label">Repaired Size</span>
								<span class="stat-value">{repairResult.repairedLength} chars</span>
							</div>
							<div class="stat-item">
								<span class="stat-label">Changes</span>
								<span class="stat-value {repairResult.repairedLength !== repairResult.originalLength ? 'highlight' : ''}">
									{repairResult.repairedLength - repairResult.originalLength > 0 ? '+' : ''}{repairResult.repairedLength - repairResult.originalLength}
								</span>
							</div>
							{#if repairResult.wasUnescaped}
								<div class="stat-item success">
									<span class="stat-label">Unescaped</span>
									<span class="stat-value"><Icon name="success" size={14} /> Yes</span>
								</div>
							{/if}
						</div>

						<div class="tabs-container">
							<div class="tabs-header">
								<button class="tab-btn {activeTab === 'diff' ? 'active' : ''}" onclick={() => activeTab = 'diff'}>
									<Icon name="compare" size={16} /> Changes
								</button>
								<button class="tab-btn {activeTab === 'preview' ? 'active' : ''}" onclick={() => activeTab = 'preview'}>
									<Icon name="code" size={16} /> Preview
								</button>
								<button class="tab-btn {activeTab === 'issues' ? 'active' : ''}" onclick={() => activeTab = 'issues'}>
									<Icon name="warning" size={16} /> Issues
									{#if issueCount > 0}
										<span class="badge {repairResult.errors.length > 0 ? 'error' : 'warning'}">{issueCount}</span>
									{/if}
								</button>
							</div>

							<div class="tab-content">
								{#if activeTab === 'diff'}
									{#if diffLines.length > 0}
										<div class="diff-view">
											{#each diffLines as diff}
												<div class="diff-line {diff.type}">
													<div class="line-number">{diff.lineNumber}</div>
													<div class="line-content">
														{#if diff.type === 'added'}
															<div class="added-line">+ {diff.repaired}</div>
														{:else if diff.type === 'removed'}
															<div class="removed-line">- {diff.original}</div>
														{:else}
															<div class="removed-line">- {diff.original}</div>
															<div class="added-line">+ {diff.repaired}</div>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<div class="empty-state">
											<Icon name="success" size={48} />
											<p>No changes needed. The JSON is already valid.</p>
										</div>
									{/if}
								{:else if activeTab === 'preview'}
									<div class="preview-view">
										<CodeBlock
											code={repairResult.repairedJSON.slice(0, 5000) + (repairResult.repairedJSON.length > 5000 ? '\n... (truncated)' : '')}
											language="json"
											showLineNumbers={true}
										/>
									</div>
								{:else if activeTab === 'issues'}
									<div class="issues-view">
										{#if issueCount === 0}
											<div class="empty-state">
												<Icon name="success" size={48} />
												<p>No issues found!</p>
											</div>
										{:else}
											{#if repairResult.errors.length > 0}
												<div class="issue-group error">
													<h4><Icon name="error" size={16} /> Errors ({repairResult.errors.length})</h4>
													<ul>
														{#each repairResult.errors as error}
															<li>{error}</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if repairResult.warnings.length > 0}
												<div class="issue-group warning">
													<h4><Icon name="warning" size={16} /> Warnings ({repairResult.warnings.length})</h4>
													<ul>
														{#each repairResult.warnings as warning}
															<li>{warning}</li>
														{/each}
													</ul>
												</div>
											{/if}
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>

	{#snippet footer()}
		<div class="footer-content">
			{#if repairResult}
				<div class="footer-info">
					{#if repairResult.success}
						<span class="success-text"><Icon name="success" size={14} /> Ready to apply</span>
					{/if}
				</div>
				<div class="footer-actions">
					<button class="btn btn-secondary" onclick={close}>Cancel</button>
					{#if repairResult.success}
						<button class="btn btn-primary" onclick={applyRepair}>
							<Icon name="success" size={16} /> Apply Repair
						</button>
					{:else}
						<button class="btn btn-warning" onclick={applyRepair} disabled={!repairResult.repairedJSON || repairResult.repairedJSON === content}>
							<Icon name="warning" size={16} /> Apply Partial Repair
						</button>
					{/if}
				</div>
			{:else}
				<button class="btn btn-secondary" onclick={close}>Close</button>
			{/if}
		</div>
	{/snippet}
</BaseModal>

<style>
	.modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.loading-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xl);
		text-align: center;
		min-height: 300px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border);
		border-top: 3px solid var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: var(--spacing-lg);
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.detection-state {
		padding: var(--spacing-xl);
		display: flex;
		justify-content: center;
	}

	.detection-card {
		max-width: 600px;
		width: 100%;
		text-align: center;
	}

	.detection-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
		color: var(--color-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto var(--spacing-lg);
	}

	.detection-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--spacing-md);
		margin: var(--spacing-xl) 0;
	}

	.action-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		padding: var(--spacing-md);
		text-align: left;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		transition: all 0.2s;
	}

	.action-card:hover {
		border-color: var(--color-primary);
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.action-card.primary {
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.05);
		border-color: rgba(var(--color-primary-rgb, 59, 130, 246), 0.3);
	}

	.action-card.primary:hover {
		background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.1);
		border-color: var(--color-primary);
	}

	.action-icon {
		width: 40px;
		height: 40px;
		border-radius: var(--border-radius-sm);
		background: var(--color-surface-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text);
	}

	.action-info {
		flex: 1;
	}

	.action-info h4 {
		margin: 0 0 var(--spacing-xs);
		color: var(--color-text);
		font-size: var(--font-size-md);
	}

	.action-info p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--font-size-xs);
	}

	.preview-box {
		background: var(--color-editor-background);
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-md);
		text-align: left;
		overflow: hidden;
	}

	.preview-header {
		padding: var(--spacing-xs) var(--spacing-md);
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.preview-box :global(.code-block) {
		border: none;
		border-radius: 0;
	}

	.results-state {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.status-banner {
		padding: var(--spacing-md) var(--spacing-lg);
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.status-banner.success {
		background: rgba(34, 197, 94, 0.1);
		color: var(--color-success);
	}

	.status-banner.error {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
	}

	.status-info h3 {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 600;
	}

	.status-info p {
		margin: var(--spacing-xs) 0 0;
		font-size: var(--font-size-sm);
		opacity: 0.9;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: var(--spacing-md);
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.stat-item {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.stat-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-secondary);
		text-transform: uppercase;
	}

	.stat-value {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text);
	}

	.stat-value.highlight {
		color: var(--color-primary);
	}

	.stat-item.success .stat-value {
		color: var(--color-success);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.tabs-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.tabs-header {
		display: flex;
		padding: 0 var(--spacing-lg);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.tab-btn {
		padding: var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		font-weight: 500;
		transition: all 0.2s;
	}

	.tab-btn:hover {
		color: var(--color-text);
	}

	.tab-btn.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.badge {
		background: var(--color-surface-secondary);
		padding: 2px 6px;
		border-radius: 10px;
		font-size: 10px;
		font-weight: bold;
	}

	.badge.error {
		background: var(--color-error);
		color: white;
	}

	.badge.warning {
		background: var(--color-warning);
		color: black;
	}

	.tab-content {
		flex: 1;
		overflow-y: auto;
		background: var(--color-editor-background);
		position: relative;
	}

	.diff-view {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
	}

	.diff-line {
		display: flex;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.line-number {
		width: 50px;
		padding: 4px 8px;
		text-align: right;
		color: var(--color-text-muted);
		background: var(--color-surface-secondary);
		border-right: 1px solid var(--color-border);
		user-select: none;
	}

	.line-content {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.added-line {
		background: rgba(34, 197, 94, 0.15);
		color: var(--color-success);
		padding: 2px 8px;
	}

	.removed-line {
		background: rgba(239, 68, 68, 0.15);
		color: var(--color-error);
		padding: 2px 8px;
		text-decoration: line-through;
		opacity: 0.7;
	}

	.preview-view {
		height: 100%;
	}

	.preview-view :global(.code-block) {
		height: 100%;
		border: none;
		border-radius: 0;
	}

	.issues-view {
		padding: var(--spacing-lg);
	}

	.issue-group {
		margin-bottom: var(--spacing-lg);
		border-radius: var(--border-radius-md);
		overflow: hidden;
		border: 1px solid transparent;
	}

	.issue-group.error {
		background: rgba(239, 68, 68, 0.05);
		border-color: rgba(239, 68, 68, 0.2);
	}

	.issue-group.warning {
		background: rgba(251, 191, 36, 0.05);
		border-color: rgba(251, 191, 36, 0.2);
	}

	.issue-group h4 {
		margin: 0;
		padding: var(--spacing-md);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.issue-group.error h4 {
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
	}

	.issue-group.warning h4 {
		background: rgba(251, 191, 36, 0.1);
		color: var(--color-warning);
	}

	.issue-group ul {
		margin: 0;
		padding: var(--spacing-md) var(--spacing-xl);
	}

	.issue-group li {
		margin-bottom: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: var(--spacing-xl);
		color: var(--color-text-secondary);
		gap: var(--spacing-md);
	}

	.footer-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.footer-actions {
		display: flex;
		gap: var(--spacing-md);
		margin-left: auto;
	}

	.success-text {
		color: var(--color-success);
		font-size: var(--font-size-sm);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.btn {
		padding: var(--spacing-sm) var(--spacing-lg);
		border-radius: var(--border-radius-sm);
		border: 1px solid transparent;
		font-size: var(--font-size-sm);
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		transition: all 0.2s;
	}

	.btn-primary {
		background: var(--color-primary);
		color: var(--color-text-inverted);
	}

	.btn-primary:hover {
		filter: brightness(0.9);
	}

	.btn-secondary {
		background: var(--color-surface);
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
	}

	.btn-warning {
		background: var(--color-warning);
		color: #000;
	}

	.btn-warning:hover {
		filter: brightness(0.9);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>