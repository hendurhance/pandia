<script lang="ts">
    import { schemaValidator, showSchemaModal, validationResult } from '$lib/stores/validation';
    import { formatError } from '$lib/utils/error';
    import Icon from '../ui/Icon.svelte';
    import BaseModal from './BaseModal.svelte';

    let { show = $bindable(false) } = $props();
    
    let schemaText = $state('');
    let hasError = $state(false);
    let errorMessage = $state('');
    let showHelp = $state(false);
    
    const currentSchema = $derived(schemaValidator.getSchema());
    
    $effect(() => {
        if (currentSchema) {
            schemaText = JSON.stringify(currentSchema, null, 2);
        }
    });
    
    function closeModal() {
        show = false;
        showSchemaModal.set(false);
    }
    
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            closeModal();
        }
    }
    
    function loadSchema() {
        if (!schemaText.trim()) return;
        
        try {
            const schema = JSON.parse(schemaText);
            const success = schemaValidator.setSchema(schema);
            
            if (success) {
                hasError = false;
                errorMessage = '';
                closeModal();
            } else {
                hasError = true;
                errorMessage = 'Invalid schema format';
            }
        } catch (error) {
            hasError = true;
            errorMessage = `JSON Parse Error: ${formatError(error)}`;
        }
    }
    
    function clearSchema() {
        schemaValidator.clearSchema();
        schemaText = '';
        hasError = false;
        errorMessage = '';
        validationResult.set(null);
    }
    
    function loadSampleSchema() {
        const sampleSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "minLength": 1
                },
                "age": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 150
                },
                "email": {
                    "type": "string",
                    "format": "email"
                },
                "address": {
                    "type": "object",
                    "properties": {
                        "street": { "type": "string" },
                        "city": { "type": "string" },
                        "zipCode": { "type": "string", "pattern": "^[0-9]{5}$" }
                    },
                    "required": ["street", "city"]
                }
            },
            "required": ["name", "email"]
        };
        
        schemaText = JSON.stringify(sampleSchema, null, 2);
        hasError = false;
        errorMessage = '';
    }

    function toggleHelp() {
        showHelp = !showHelp;
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<BaseModal
    bind:visible={show}
    title="JSON Schema Validation"
    subtitle="Validate your JSON documents against a schema"
    icon="shield"
    width="lg"
    onclose={closeModal}
>
    <div class="modal-body">
                <div class="toolbar">
                    <div class="status-indicator {currentSchema ? 'active' : 'inactive'}">
                        <Icon name={currentSchema ? 'success' : 'warning'} size={14} />
                        <span>{currentSchema ? 'Schema Active' : 'No Schema Loaded'}</span>
                    </div>
                    
                    <div class="actions">
                        <button class="btn btn-secondary btn-sm" onclick={loadSampleSchema} title="Load a sample schema">
                            <Icon name="code" size={14} />
                            <span>Load Sample</span>
                        </button>
                        {#if currentSchema}
                            <button class="btn btn-danger btn-sm" onclick={clearSchema} title="Clear current schema">
                                <Icon name="trash" size={14} />
                                <span>Clear</span>
                            </button>
                        {/if}
                        <button class="btn btn-icon" onclick={toggleHelp} title="Schema Help" class:active={showHelp}>
                            <Icon name="help" size={16} />
                        </button>
                    </div>
                </div>

                {#if showHelp}
                    <div class="help-panel">
                        <h3><Icon name="info" size={14} /> Schema Guide</h3>
                        <div class="help-grid">
                            <div class="help-item"><code>type</code> <span>Data type (string, number, object, array, boolean, null)</span></div>
                            <div class="help-item"><code>properties</code> <span>Defines properties for objects</span></div>
                            <div class="help-item"><code>required</code> <span>Lists required properties</span></div>
                            <div class="help-item"><code>format</code> <span>Validates string formats (email, date, uri, etc.)</span></div>
                            <div class="help-item"><code>minimum</code> <span>Validates number ranges</span></div>
                            <div class="help-item"><code>pattern</code> <span>Validates strings with regex</span></div>
                        </div>
                        <a href="https://json-schema.org/" target="_blank" rel="noopener" class="help-link">Learn more at json-schema.org</a>
                    </div>
                {/if}
                
                <div class="editor-container">
                    <textarea
                        class="schema-editor"
                        bind:value={schemaText}
                        placeholder="Paste your JSON Schema here..."
                        spellcheck="false"
                    ></textarea>
                </div>
                
                {#if hasError}
                    <div class="error-banner">
                        <Icon name="error" size={16} />
                        <span>{errorMessage}</span>
                    </div>
                {/if}
    </div>

    {#snippet footer()}
        <div class="footer-content">
            <div class="footer-info">
                {#if currentSchema}
                    <span>Validation enabled</span>
                {:else}
                    <span>Validation disabled</span>
                {/if}
            </div>
            <div class="footer-actions">
                <button class="btn btn-secondary" onclick={closeModal}>Cancel</button>
                <button class="btn btn-primary" onclick={loadSchema} disabled={!schemaText.trim()}>
                    <Icon name="success" size={16} />
                    <span>Apply Schema</span>
                </button>
            </div>
        </div>
    {/snippet}
</BaseModal>

<style>
    .modal-body {
        display: flex;
        flex-direction: column;
        height: 500px;
    }

    .toolbar {
        padding: 10px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--color-border, #444);
        background: var(--color-surface, #2d2d2d);
    }

    .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
    }

    .status-indicator.active {
        color: #4ade80;
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.2);
    }

    .status-indicator.inactive {
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.2);
    }

    .actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .help-panel {
        background: var(--color-surface-secondary, #252526);
        padding: 12px 20px;
        border-bottom: 1px solid var(--color-border, #444);
        font-size: 13px;
    }

    .help-panel h3 {
        margin: 0 0 10px 0;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--color-primary, #007acc);
    }

    .help-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 8px;
        margin-bottom: 10px;
    }

    .help-item {
        display: flex;
        gap: 8px;
        align-items: baseline;
    }

    .help-item code {
        background: rgba(255, 255, 255, 0.1);
        padding: 2px 6px;
        border-radius: 3px;
        font-family: var(--font-mono, monospace);
        color: #9cdcfe;
        font-size: 12px;
    }

    .help-item span {
        color: var(--color-text-secondary, #999);
        font-size: 12px;
    }

    .help-link {
        color: var(--color-primary, #007acc);
        text-decoration: none;
        font-size: 12px;
    }

    .help-link:hover {
        text-decoration: underline;
    }

    .editor-container {
        flex: 1;
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 200px;
        overflow: hidden;
    }

    .schema-editor {
        flex: 1;
        background: var(--color-editor-background, #1e1e1e);
        border: none;
        color: var(--color-text, #d4d4d4);
        font-family: var(--font-mono, 'Menlo', 'Monaco', 'Courier New', monospace);
        font-size: 13px;
        line-height: 1.5;
        padding: 16px 20px;
        resize: none;
        outline: none;
    }

    .error-banner {
        background: rgba(239, 68, 68, 0.1);
        border-top: 1px solid rgba(239, 68, 68, 0.3);
        color: #ef4444;
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
    }

    .footer-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
    }

    .footer-info {
        color: var(--color-text-secondary, #999);
        font-size: 12px;
    }

    .footer-actions {
        display: flex;
        gap: 10px;
    }

    .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: inherit;
    }

    .btn-sm {
        padding: 4px 10px;
        font-size: 12px;
    }

    .btn-icon {
        padding: 6px;
        background: transparent;
        color: var(--color-text-secondary, #ccc);
    }

    .btn-icon:hover, .btn-icon.active {
        background: rgba(255, 255, 255, 0.1);
        color: var(--color-text, #fff);
    }

    .btn-icon.active {
        color: var(--color-primary, #007acc);
    }

    .btn-primary {
        background: var(--color-primary, #007acc);
        color: white;
    }

    .btn-primary:hover {
        background: #0062a3;
    }

    .btn-primary:disabled {
        background: rgba(0, 122, 204, 0.5);
        cursor: not-allowed;
        opacity: 0.7;
    }

    .btn-secondary {
        background: var(--color-surface-secondary, #3c3c3c);
        color: var(--color-text-secondary, #ccc);
        border: 1px solid var(--color-border, #555);
    }

    .btn-secondary:hover {
        background: var(--color-surface-hover, #4a4a4a);
        color: var(--color-text, #fff);
    }

    .btn-danger {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .btn-danger:hover {
        background: rgba(239, 68, 68, 0.2);
    }
</style>