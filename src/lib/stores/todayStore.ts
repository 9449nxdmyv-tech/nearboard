/**
 * @file todayStore.ts
 * @description Reactive store for the Today Dashboard cross-board digest.
 *              Never fetch inline in TodayDashboard.svelte — all data sourced here.
 *              Provides briefings, voice notes, streaks, reminders, and per-board item counts.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { BriefingDoc, VoiceContentDoc, BoardDoc, ContentType } from '$lib/types';

export interface BoardBriefing {
	boardId: string;
	boardName: string;
	briefing: BriefingDoc;
}

export interface UnplayedVoice {
	boardId: string;
	boardName: string;
	contentId: string;
	authorName: string;
	audioUrl: string;
	durationMs: number;
}

export interface BoardStreak {
	boardId: string;
	boardName: string;
	streak: number;
}

export interface BoardReminder {
	boardId: string;
	boardName: string;
	text: string;
	sentAt: Date;
}

export interface BoardItemCounts {
	boardId: string;
	total: number;
	byType: Partial<Record<ContentType, number>>;
}

export interface TodayState {
	loading: boolean;
	briefings: BoardBriefing[];
	unplayedVoiceNotes: UnplayedVoice[];
	streaks: BoardStreak[];
	reminders: BoardReminder[];
	newItemCounts: BoardItemCounts[];
}

const initial: TodayState = {
	loading: false,
	briefings: [],
	unplayedVoiceNotes: [],
	streaks: [],
	reminders: [],
	newItemCounts: []
};

export const todayStore = writable<TodayState>(initial);

/**
 * Loads Today Dashboard data across all user boards.
 * Fetches latest briefing, unplayed voice notes, streak info, reminders,
 * and new item counts per board.
 */
export async function loadTodayData(boards: BoardDoc[]): Promise<void> {
	if (!browser) return;
	todayStore.update((s) => ({ ...s, loading: true }));

	try {
		const {
			collection,
			query,
			orderBy,
			where,
			getDocs,
			limit
		} = await import('firebase/firestore');
		const { db: getDbFn } = await import('$lib/firebase/app');
		const db = getDbFn();

		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		// Fetch all boards in parallel instead of sequentially (avoids N+1)
		const boardResults = await Promise.all(boards.map(async (board) => {
			const briefings: BoardBriefing[] = [];
			const unplayedVoiceNotes: UnplayedVoice[] = [];
			const streaks: BoardStreak[] = [];
			const reminders: BoardReminder[] = [];

			// Streak — only notable ones (≥3 days)
			if (board.streak >= 3) {
				streaks.push({
					boardId: board.id,
					boardName: board.name,
					streak: board.streak
				});
			}

			// Run all 4 queries for this board in parallel
			const [briefingSnap, voiceSnap, recentSnap, remindersSnap] = await Promise.all([
				getDocs(query(
					collection(db, 'boards', board.id, 'briefings'),
					orderBy('generatedAt', 'desc'),
					limit(1)
				)),
				getDocs(query(
					collection(db, 'boards', board.id, 'content'),
					where('type', '==', 'voice'),
					where('createdAt', '>=', sevenDaysAgo),
					orderBy('createdAt', 'desc'),
					limit(10)
				)),
				getDocs(query(
					collection(db, 'boards', board.id, 'content'),
					where('createdAt', '>=', oneDayAgo),
					orderBy('createdAt', 'desc'),
					limit(20)
				)),
				getDocs(query(
					collection(db, 'boards', board.id, 'reminders_sent'),
					where('sentAt', '>=', todayStart),
					orderBy('sentAt', 'desc')
				))
			]);

			if (!briefingSnap.empty) {
				const d = briefingSnap.docs[0];
				briefings.push({
					boardId: board.id,
					boardName: board.name,
					briefing: { id: d.id, ...d.data() } as BriefingDoc
				});
			}

			for (const d of voiceSnap.docs) {
				const data = d.data() as VoiceContentDoc;
				unplayedVoiceNotes.push({
					boardId: board.id,
					boardName: board.name,
					contentId: d.id,
					authorName: data.authorName,
					audioUrl: data.audioUrl,
					durationMs: data.durationMs
				});
			}

			// Count new items by type instead of storing raw activity
			const byType: Partial<Record<ContentType, number>> = {};
			for (const d of recentSnap.docs) {
				const type = d.data().type as ContentType;
				byType[type] = (byType[type] || 0) + 1;
			}
			const itemCounts: BoardItemCounts = {
				boardId: board.id,
				total: recentSnap.size,
				byType
			};

			for (const d of remindersSnap.docs) {
				const data = d.data();
				reminders.push({
					boardId: board.id,
					boardName: board.name,
					text: data.text as string,
					sentAt: (data.sentAt as { toDate(): Date })?.toDate?.() ?? new Date()
				});
			}

			return { briefings, unplayedVoiceNotes, streaks, reminders, itemCounts };
		}));

		// Merge results from all boards
		const briefings = boardResults.flatMap((r) => r.briefings);
		const unplayedVoiceNotes = boardResults.flatMap((r) => r.unplayedVoiceNotes);
		const streaks = boardResults.flatMap((r) => r.streaks);
		const reminders = boardResults.flatMap((r) => r.reminders);
		const newItemCounts = boardResults
			.map((r) => r.itemCounts)
			.filter((c) => c.total > 0);

		todayStore.set({
			loading: false,
			briefings,
			unplayedVoiceNotes,
			streaks,
			reminders,
			newItemCounts
		});
	} catch {
		todayStore.update((s) => ({ ...s, loading: false }));
	}
}
