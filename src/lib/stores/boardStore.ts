/**
 * @file boardStore.ts
 * @description Reactive store for the user's board list. Wired to Firestore
 *              via subscribeToBoardsForUser() — call when user signs in, unsub on sign out.
 */

import { writable, derived, get } from 'svelte/store';
import { Timestamp, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { subscribeToUserBoards, loadMoreContent, getAllReadTimestamps, CONTENT_PAGE_SIZE } from '$lib/firebase/boardService';
import type { BoardDoc, ContentDoc } from '$lib/types';
import type { Unsubscribe } from 'firebase/firestore';

interface BoardState {
	boards: BoardDoc[];
	activeBoardId: string | null;
	unreadBoardIds: Set<string>;
	loading: boolean;
	error: string | null;
}

const initial: BoardState = {
	boards: [],
	activeBoardId: null,
	unreadBoardIds: new Set(),
	loading: false,
	error: null
};

export const boardStore = writable<BoardState>(initial);

let unsubBoards: Unsubscribe | null = null;
/** Track which board IDs we've already checked, to avoid re-fetching on every snapshot */
let lastCheckedBoardKey = '';

/**
 * Compute unread set using a single consolidated readState doc (1 read total).
 * Only re-fetches when the board list changes (by comparing sorted IDs).
 */
async function refreshUnreadState(userId: string, boards: BoardDoc[]): Promise<void> {
	const boardKey = boards.map((b) => b.id).sort().join(',');
	if (boardKey === lastCheckedBoardKey) return;
	lastCheckedBoardKey = boardKey;

	try {
		const readTimestamps = await getAllReadTimestamps(userId);
		const unread = new Set<string>();

		for (const board of boards) {
			if (!board.lastActivityAt) continue;
			const lastReadAt = readTimestamps.get(board.id);
			if (!lastReadAt || board.lastActivityAt.toMillis() > lastReadAt.toMillis()) {
				unread.add(board.id);
			}
		}

		boardStore.update((s) => ({ ...s, unreadBoardIds: unread }));
	} catch { /* permission denied or doc missing — skip */ }
}

/**
 * Starts a real-time Firestore listener for the user's boards.
 * Safe to call multiple times — tears down the previous listener first.
 */
export function subscribeToBoardsForUser(userId: string): void {
	unsubBoards?.();
	lastCheckedBoardKey = '';
	boardStore.update((s) => ({ ...s, loading: true, error: null }));

	unsubBoards = subscribeToUserBoards(
		userId,
		(boards) => {
			boardStore.set({
				boards,
				activeBoardId: get(boardStore).activeBoardId,
				unreadBoardIds: get(boardStore).unreadBoardIds,
				loading: false,
				error: null
			});
			refreshUnreadState(userId, boards);
		},
		(err) => {
			boardStore.update((s) => ({ ...s, loading: false, error: err.message }));
		}
	);
}

/**
 * Tears down the Firestore listener and resets state.
 */
export function unsubscribeBoards(): void {
	unsubBoards?.();
	unsubBoards = null;
	lastCheckedBoardKey = '';
	boardStore.set(initial);
}

/**
 * Forces a re-check of unread state (e.g. after markBoardRead).
 */
export function invalidateUnreadState(): void {
	// Reset the key so the next snapshot update will re-trigger refreshUnreadState
	lastCheckedBoardKey = '';
}

/**
 * Sets the active board ID (used by board view).
 */
export function setActiveBoard(boardId: string | null): void {
	boardStore.update((s) => ({ ...s, activeBoardId: boardId }));
}

// ─── Board content pagination ─────────────────────────────────────────────────

interface BoardContentPaginationState {
	extraContent: ContentDoc[];
	lastDoc: QueryDocumentSnapshot<DocumentData> | null;
	hasMore: boolean;
	loadingMore: boolean;
}

const contentPaginationInitial: BoardContentPaginationState = {
	extraContent: [],
	lastDoc: null,
	hasMore: true,
	loadingMore: false
};

export const boardContentPagination = writable<BoardContentPaginationState>(contentPaginationInitial);

/**
 * Resets pagination state. Call when navigating to a new board or when the
 * first-page subscription fires (since first-page data is fresh).
 */
export function resetContentPagination(lastDoc: QueryDocumentSnapshot<DocumentData> | null): void {
	boardContentPagination.set({
		extraContent: [],
		lastDoc,
		hasMore: lastDoc !== null,
		loadingMore: false
	});
}

/**
 * Loads the next page of board content.
 * Appends results to extraContent and advances the cursor.
 */
export async function loadMoreBoardContent(boardId: string): Promise<void> {
	const state = get(boardContentPagination);
	if (!state.hasMore || state.loadingMore || !state.lastDoc) return;

	boardContentPagination.update((s) => ({ ...s, loadingMore: true }));

	try {
		const { items, lastDoc } = await loadMoreContent(boardId, state.lastDoc);
		boardContentPagination.update((s) => ({
			extraContent: [...s.extraContent, ...items],
			lastDoc: lastDoc ?? s.lastDoc,
			hasMore: items.length >= CONTENT_PAGE_SIZE,
			loadingMore: false
		}));
	} catch (err) {
		console.error('Failed to load more content:', err);
		boardContentPagination.update((s) => ({ ...s, loadingMore: false }));
	}
}

// ─── Optimistic content UI ────────────────────────────────────────────────────

/** Temporary content items appended optimistically before Firestore confirms. */
export const optimisticContent = writable<ContentDoc[]>([]);

/**
 * Merges real Firestore content with optimistic items.
 * Optimistic items whose temp IDs have been superseded by real docs are dropped
 * automatically when the Firestore subscription fires, because we clear them
 * once the write resolves or the snapshot arrives.
 */
export function mergeWithOptimistic(realContent: ContentDoc[]): ContentDoc[] {
	const optimistic = get(optimisticContent);
	if (optimistic.length === 0) return realContent;
	// Filter out optimistic items that have been replaced by real ones (matching authorId + type + createdAt proximity)
	const realIds = new Set(realContent.map((c) => c.id));
	const remaining = optimistic.filter((o) => !realIds.has(o.id));
	return [...remaining, ...realContent];
}

/**
 * Adds an optimistic card to the store and kicks off the real Firestore write.
 * Returns the real document ID once the write completes.
 * The optimistic item is removed after 10s as a safety net (Firestore snapshot
 * normally replaces it much sooner).
 */
export async function addContentOptimistic(
	boardId: string,
	data: Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'>,
	writeFn: (boardId: string, data: Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'>) => Promise<string>
): Promise<string> {
	const tempId = `temp-${Date.now()}`;
	const tempItem: ContentDoc = {
		...data,
		id: tempId,
		boardId,
		moderationStatus: 'approved',
		createdAt: Timestamp.now()
	} as ContentDoc;

	optimisticContent.update((items) => [tempItem, ...items]);

	const cleanup = () => {
		optimisticContent.update((items) => items.filter((i) => i.id !== tempId));
	};

	// Safety net: remove optimistic item after 10 seconds regardless
	const safetyTimer = setTimeout(cleanup, 10_000);

	try {
		const realId = await writeFn(boardId, data);
		clearTimeout(safetyTimer);
		cleanup();
		return realId;
	} catch (err) {
		clearTimeout(safetyTimer);
		cleanup();
		throw err;
	}
}
