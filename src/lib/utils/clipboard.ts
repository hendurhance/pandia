/**
 * Clipboard utilities for reading and writing to system clipboard
 */

/**
 * Copy text to clipboard
 * @param text - Text to copy
 * @returns true if successful, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.error('Failed to copy to clipboard:', error);
		return false;
	}
}

/**
 * Read text from clipboard
 * @returns The clipboard text content, or null if failed
 */
export async function readFromClipboard(): Promise<string | null> {
	try {
		return await navigator.clipboard.readText();
	} catch (error) {
		console.error('Failed to read from clipboard:', error);
		return null;
	}
}
