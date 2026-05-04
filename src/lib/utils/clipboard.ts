/**
 * @file clipboard.ts
 * @description Shared clipboard utility. Writes text to clipboard and shows a toast.
 */

import { showToast } from '$lib/stores/toastStore';

/**
 * Copies text to clipboard and shows a success toast.
 * Returns true on success, false on failure (also toasts error).
 */
export async function copyToClipboard(
	text: string,
	successMessage = 'Copied to clipboard!'
): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		showToast(successMessage, 'success');
		return true;
	} catch {
		showToast('Failed to copy', 'error');
		return false;
	}
}
