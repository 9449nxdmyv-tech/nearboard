/**
 * @file feedStore.ts
 * @description Store for the Global Feed — aggregates content across all
 *              user's boards with explicit sort modes. No hidden algorithms.
 */

import { writable } from 'svelte/store';
import type { ContentDoc, BriefingDoc } from '$lib/types';

export type FeedSortMode = 'latest' | 'unread' | 'by-board' | 'most-active';

export interface FeedItem {
	content: ContentDoc;
	boardName: string;
	boardId: string;
	isOwner: boolean;
	allowComments: boolean;
	/** Per-board lastReadAt — used by unread sort and the "Last Seen" divider */
	lastReadAt?: Date;
}

export interface CalmBriefing {
	boardId: string;
	boardName: string;
	briefing: BriefingDoc;
}

export interface FeedState {
	items: FeedItem[];
	calmBriefings: CalmBriefing[];
	sortMode: FeedSortMode;
	calmMode: boolean;
	loading: boolean;
	unseenCount: number;
}

const initial: FeedState = {
	items: [],
	calmBriefings: [],
	sortMode: 'latest',
	calmMode: false,
	loading: false,
	unseenCount: 0
};

export const feedStore = writable<FeedState>(initial);

export function setSortMode(mode: FeedSortMode): void {
	feedStore.update((s) => ({ ...s, sortMode: mode }));
}

export function toggleCalmMode(): void {
	feedStore.update((s) => ({ ...s, calmMode: !s.calmMode }));
}

/**
 * Populates the feed from board data.
 * Unseen count is based on per-board lastReadAt timestamps on each FeedItem.
 */
export function setFeedItems(items: FeedItem[]): void {
	const unseenCount = items.filter((i) => {
		const readAt = i.lastReadAt?.getTime() ?? 0;
		const createdAt = i.content.createdAt?.toMillis?.() ?? 0;
		return readAt === 0 || createdAt > readAt;
	}).length;

	feedStore.update((s) => ({ ...s, items, unseenCount, loading: false }));
}

/**
 * Marks all current items as read by updating their lastReadAt to now.
 * Call after persisting the read state to Firestore.
 */
export function markAllFeedRead(): void {
	const now = new Date();
	feedStore.update((s) => ({
		...s,
		items: s.items.map((i) => ({ ...i, lastReadAt: now })),
		unseenCount: 0
	}));
}

export function setCalmBriefings(briefings: CalmBriefing[]): void {
	feedStore.update((s) => ({ ...s, calmBriefings: briefings }));
}

export function setFeedLoading(loading: boolean): void {
	feedStore.update((s) => ({ ...s, loading }));
}

// ─── Sort helpers (shared timestamp extraction) ─────────────────────────────

function createdAtMs(item: FeedItem): number {
	return item.content.createdAt?.toMillis?.() ?? 0;
}

/**
 * Returns sorted feed items based on the current sort mode.
 */
export function sortFeedItems(items: FeedItem[], mode: FeedSortMode): FeedItem[] {
	const sorted = [...items];

	switch (mode) {
		case 'latest':
			sorted.sort((a, b) => createdAtMs(b) - createdAtMs(a));
			break;

		case 'by-board':
			sorted.sort((a, b) => {
				const cmp = a.boardName.localeCompare(b.boardName);
				return cmp !== 0 ? cmp : createdAtMs(b) - createdAtMs(a);
			});
			break;

		case 'most-active': {
			const counts = new Map<string, number>();
			for (const item of items) {
				counts.set(item.boardId, (counts.get(item.boardId) ?? 0) + 1);
			}
			sorted.sort((a, b) => {
				const diff = (counts.get(b.boardId) ?? 0) - (counts.get(a.boardId) ?? 0);
				return diff !== 0 ? diff : createdAtMs(b) - createdAtMs(a);
			});
			break;
		}

		case 'unread':
		default: {
			sorted.sort((a, b) => {
				const aTime = createdAtMs(a);
				const bTime = createdAtMs(b);
				const aReadAt = a.lastReadAt?.getTime() ?? 0;
				const bReadAt = b.lastReadAt?.getTime() ?? 0;
				const aUnread = aReadAt === 0 || aTime > aReadAt;
				const bUnread = bReadAt === 0 || bTime > bReadAt;
				if (aUnread !== bUnread) return aUnread ? -1 : 1;
				return bTime - aTime;
			});
			break;
		}
	}

	return sorted;
}

/**
 * Finds the index of the first "read" item in a sorted (unread-first) list.
 * Returns -1 if all items are unread or the list is empty.
 */
export function findLastSeenDivider(items: FeedItem[]): number {
	for (let i = 0; i < items.length; i++) {
		const readAt = items[i].lastReadAt?.getTime() ?? 0;
		const createdAt = items[i].content.createdAt?.toMillis?.() ?? 0;
		if (readAt > 0 && createdAt <= readAt) return i;
	}
	return -1;
}
