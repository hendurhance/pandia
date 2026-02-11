<script lang="ts">
    import { onMount } from "svelte";
    import Icon from "../ui/Icon.svelte";

    let {
        show = $bindable(false),
        onFind,
        onReplace,
        onReplaceAll,
    }: {
        show?: boolean;
        onFind?: (term: string, options: FindOptions) => void;
        onReplace?: (
            findTerm: string,
            replaceTerm: string,
            options: FindOptions,
        ) => void;
        onReplaceAll?: (
            findTerm: string,
            replaceTerm: string,
            options: FindOptions,
        ) => void;
    } = $props();

    interface FindOptions {
        caseSensitive: boolean;
        wholeWord: boolean;
        useRegex: boolean;
    }

    let findTerm = $state("");
    let replaceTerm = $state("");
    let caseSensitive = $state(false);
    let wholeWord = $state(false);
    let useRegex = $state(false);
    let findInput: HTMLInputElement | undefined = $state();

    let options = $derived({ caseSensitive, wholeWord, useRegex });

    function closeModal() {
        show = false;
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            closeModal();
        } else if (event.key === "Enter") {
            if (event.shiftKey) {
                handleReplaceAll();
            } else if (event.ctrlKey || event.metaKey) {
                handleReplace();
            } else {
                handleFind();
            }
        }
    }

    function handleFind() {
        if (findTerm.trim()) {
            onFind?.(findTerm, options);
        }
    }

    function handleReplace() {
        if (findTerm.trim()) {
            onReplace?.(findTerm, replaceTerm, options);
        }
    }

    function handleReplaceAll() {
        if (findTerm.trim()) {
            onReplaceAll?.(findTerm, replaceTerm, options);
        }
    }

    onMount(() => {
        if (show && findInput) {
            findInput.focus();
        }
    });

    $effect(() => {
        if (show && findInput) {
            const timer = setTimeout(() => findInput && findInput.focus(), 100);
            return () => clearTimeout(timer);
        }
    });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
    <!-- Non-blocking floating panel (no overlay) -->
    <div
        class="find-replace-panel"
        role="dialog"
        aria-labelledby="find-replace-title"
    >
        <div class="modal-header">
            <h2 id="find-replace-title">
                <Icon name="find-replace" size={20} />
                Find & Replace
            </h2>
            <button
                class="close-btn"
                onclick={closeModal}
                aria-label="Close find & replace modal"
            >
                <Icon name="close" size={18} />
            </button>
        </div>

        <div class="find-replace-content">
            <div class="input-group">
                <label for="find-input">Find:</label>
                <div class="input-wrapper">
                    <Icon name="search" size={14} class="input-icon" />
                    <input
                        id="find-input"
                        bind:this={findInput}
                        bind:value={findTerm}
                        class="input has-icon"
                        placeholder="Search term..."
                        onkeydown={(e) =>
                            e.key === "Enter" && !e.shiftKey && handleFind()}
                        enterkeyhint="search"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                    />
                </div>
            </div>

            <div class="input-group">
                <label for="replace-input">Replace:</label>
                <div class="input-wrapper">
                    <Icon name="refresh" size={14} class="input-icon" />
                    <input
                        id="replace-input"
                        bind:value={replaceTerm}
                        class="input has-icon"
                        placeholder="Replacement term..."
                        onkeydown={(e) =>
                            e.key === "Enter" && !e.shiftKey && handleReplace()}
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                    />
                </div>
            </div>

            <div class="options-group">
                <label class="checkbox-label">
                    <input type="checkbox" bind:checked={caseSensitive} />
                    <span>Case Sensitive</span>
                </label>

                <label class="checkbox-label">
                    <input type="checkbox" bind:checked={wholeWord} />
                    <span>Whole Word</span>
                </label>

                <label class="checkbox-label">
                    <input type="checkbox" bind:checked={useRegex} />
                    <span>Regular Expression</span>
                </label>
            </div>

            <div class="button-group">
                <button class="btn btn-primary" onclick={handleFind}>
                    <Icon name="search" size={14} />
                    Find Next
                </button>
                <button class="btn btn-secondary" onclick={handleReplace}>
                    <Icon name="refresh" size={14} />
                    Replace
                </button>
                <button class="btn btn-secondary" onclick={handleReplaceAll}>
                    <Icon name="batch" size={14} />
                    Replace All
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .find-replace-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 1100;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--border-radius-lg);
        padding: var(--spacing-lg);
        box-shadow: var(--shadow-xl);
        width: min(480px, 90vw);
        max-height: 80vh;
        overflow-y: auto;
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
    }

    .modal-header h2 {
        margin: 0;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 18px;
    }

    .close-btn {
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        padding: 4px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .find-replace-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .input-group label {
        font-size: 14px;
        font-weight: 500;
        color: #ccc;
    }

    .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    :global(.input-icon) {
        position: absolute;
        left: 10px;
        color: #888;
        pointer-events: none;
    }

    .find-replace-panel .input {
        text-transform: none !important;
        width: 100%;
        padding: 8px 12px;
        background: #1e1e1e;
        border: 1px solid #444;
        border-radius: 4px;
        color: #fff;
        font-family: inherit;
    }

    .find-replace-panel .input:focus {
        outline: none;
        border-color: #007acc;
    }

    .input.has-icon {
        padding-left: 32px;
    }

    .options-group {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        color: #ccc;
        cursor: pointer;
        user-select: none;
    }

    .checkbox-label input[type="checkbox"] {
        margin: 0;
    }

    .button-group {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background 0.2s;
    }

    .btn-primary {
        background: #007acc;
        color: #fff;
    }

    .btn-primary:hover {
        background: #0062a3;
    }

    .btn-secondary {
        background: var(--color-surface-secondary, #3c3c3c);
        color: var(--color-text-secondary, #ccc);
        border: 1px solid var(--color-border, #555);
    }

    .btn-secondary:hover {
        background: var(--color-surface-hover, #4c4c4c);
        color: var(--color-text, #fff);
    }
</style>
