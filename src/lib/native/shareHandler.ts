/**
 * @file shareHandler.ts
 * @description Handles incoming shared content from native share sheets (iOS/Android).
 *              Uses @capacitor/app to listen for deep links and shared URLs/text.
 *              Supports shared images (uploaded as photo cards) and board selection.
 * @todos
 *   - LOW FEATURE: Support shared files (PDFs, documents)
 */

import { browser } from '$app/environment';
import { Capacitor } from '@capacitor/core';
import { get } from 'svelte/store';
import { routeCapture, loadCorrections, type BoardSummary } from '$lib/services';

interface SharedContent {
	url?: string;
	text?: string;
	title?: string;
	imageFiles?: File[];
}

type ShareCallback = (content: SharedContent, boardId: string) => void;

let listener: ShareCallback | null = null;

/** Key for persisting the last-used board ID so repeat shares go to the same board. */
const LAST_BOARD_KEY = 'nearboard_last_shared_board';

/**
 * Selects a board for saving shared content. Uses the Smart Capture Router
 * when possible, falling back to a prompt picker for low-confidence results.
 * Returns null if no boards exist or the user cancels.
 */
async function selectBoard(sharedContent?: SharedContent): Promise<string | null> {
	const { boardStore } = await import('$lib/stores/boardStore');
	const state = get(boardStore);
	const boards = state.boards;

	if (boards.length === 0) return null;
	if (boards.length === 1) {
		localStorage.setItem(LAST_BOARD_KEY, boards[0].id);
		return boards[0].id;
	}

	// Try smart routing if we have shared content
	const contentText = sharedContent?.url ?? sharedContent?.text ?? sharedContent?.title ?? '';
	if (contentText) {
		const boardSummaries: BoardSummary[] = boards.map((b) => ({
			id: b.id,
			name: b.name,
			summary: b.livingSummary?.content ?? null
		}));

		const result = routeCapture({
			content: contentText,
			activeBoardId: null,
			boards: boardSummaries,
			lastUsedBoardId: localStorage.getItem(LAST_BOARD_KEY),
			corrections: loadCorrections()
		});

		if (result && result !== 'needs-ai' && result.boardId && result.confidence !== 'low') {
			localStorage.setItem(LAST_BOARD_KEY, result.boardId);
			return result.boardId;
		}
	}

	// Check for a previously-used board that still exists
	const lastUsed = localStorage.getItem(LAST_BOARD_KEY);
	if (lastUsed && boards.some((b) => b.id === lastUsed)) {
		return lastUsed;
	}

	// Simple prompt listing boards by number (works on all platforms)
	const options = boards.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
	const choice = window.prompt(`Save to which board?\n\n${options}\n\nEnter number:`, '1');
	if (!choice) return null;

	const idx = parseInt(choice, 10) - 1;
	if (idx < 0 || idx >= boards.length) return boards[0].id;

	const boardId = boards[idx].id;
	localStorage.setItem(LAST_BOARD_KEY, boardId);
	return boardId;
}

/**
 * Handles shared image files — uploads them and creates a photo card.
 */
async function handleSharedImages(
	imageFiles: File[],
	boardId: string,
	userId: string,
	userName: string,
	userPhotoURL: string | null
): Promise<void> {
	const { uploadPhotos } = await import('$lib/firebase/storageService');
	const { addContent } = await import('$lib/firebase/boardService');

	const urls = await uploadPhotos(boardId, userId, imageFiles);

	await addContent(boardId, {
		type: 'photo',
		boardId,
		authorId: userId,
		authorName: userName,
		authorPhotoURL: userPhotoURL ?? null,
		images: urls,
		caption: null
	} as Parameters<typeof addContent>[1]);
}

/**
 * Registers a listener for incoming shared content from native share sheets.
 * Call once in the root layout after auth is established.
 *
 * The callback receives the shared content together with the selected board ID.
 */
export async function initShareHandler(callback: ShareCallback): Promise<void> {
	if (!browser || !Capacitor.isNativePlatform()) return;

	listener = callback;

	const { App } = await import('@capacitor/app');

	// Handle incoming app URL (deep links / share sheet)
	App.addListener('appUrlOpen', async (event) => {
		if (!listener || !event.url) return;

		// Build shared content first so we can use it for smart routing
		const content: SharedContent = { url: event.url };
		const boardId = await selectBoard(content);
		if (!boardId) return;
		const isImage = /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(event.url);

		if (isImage) {
			try {
				const response = await fetch(event.url);
				const blob = await response.blob();
				const ext = event.url.split('.').pop()?.split('?')[0] ?? 'jpg';
				const file = new File([blob], `shared-image.${ext}`, { type: blob.type || 'image/jpeg' });
				content.imageFiles = [file];
			} catch {
				console.error('[ShareHandler] Failed to fetch shared image from URL');
			}
		}

		listener(content, boardId);
	});
}

/**
 * Processes a shared payload — call from the share callback to handle
 * image uploads automatically. Returns true if images were handled.
 */
export async function processSharedImages(
	content: SharedContent,
	boardId: string,
	userId: string,
	userName: string,
	userPhotoURL: string | null
): Promise<boolean> {
	if (!content.imageFiles || content.imageFiles.length === 0) return false;
	await handleSharedImages(content.imageFiles, boardId, userId, userName, userPhotoURL);
	return true;
}

/**
 * Shares content from the app using the native share sheet.
 */
export async function shareContent(title: string, text: string, url?: string): Promise<void> {
	if (!browser) return;

	if (Capacitor.isNativePlatform()) {
		const { Share } = await import('@capacitor/share');
		await Share.share({ title, text, url, dialogTitle: 'Share from Nearboard' });
	} else if (navigator.share) {
		await navigator.share({ title, text, url });
	}
}
