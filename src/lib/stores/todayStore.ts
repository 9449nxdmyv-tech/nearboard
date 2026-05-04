/**
 * @file todayStore.ts
 * @description Reactive store for the Today Dashboard cross-board digest.
 *              Never fetch inline in TodayDashboard.svelte — all data sourced here.
 *              Provides briefings, voice notes, streaks, reminders, and per-board item counts.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { BriefingDoc, VoiceContentDoc, BoardDoc, ContentType, MemoryDoc } from '$lib/types';

export interface BoardBriefing {
	boardId: string;
	boardName: string;
	briefing: BriefingDoc;
}

export interface RecentVoice {
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
	error: string | null;
	briefings: BoardBriefing[];
	recentVoiceNotes: RecentVoice[];
	streaks: BoardStreak[];
	reminders: BoardReminder[];
	newItemCounts: BoardItemCounts[];
	memories: MemoryDoc[];
}

const initial: TodayState = {
	loading: false,
	error: null,
	briefings: [],
	recentVoiceNotes: [],
	streaks: [],
	reminders: [],
	newItemCounts: [],
	memories: []
};

export const todayStore = writable<TodayState>(initial);

// Request counter so a slow in-flight load can't overwrite a newer one (e.g.,
// pull-to-refresh fired during the initial fetch).
let activeRequestId = 0;

/**
 * Loads Today Dashboard data across all user boards.
 * Fetches latest briefing, recent voice notes, streak info, reminders,
 * and new item counts per board.
 */
export async function loadTodayData(boards: BoardDoc[], uid?: string): Promise<void> {
	if (!browser) return;
	const requestId = ++activeRequestId;
	todayStore.update((s) => ({ ...s, loading: true, error: null }));

	try {
		const {
			collection,
			query,
			orderBy,
			where,
			getDocs,
			limit,
			doc: firestoreDoc
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
			const recentVoiceNotes: RecentVoice[] = [];
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
				recentVoiceNotes.push({
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

			return { briefings, recentVoiceNotes, streaks, reminders, itemCounts };
		}));

		// Merge results from all boards
		const briefings = boardResults.flatMap((r) => r.briefings);
		const recentVoiceNotes = boardResults.flatMap((r) => r.recentVoiceNotes);
		const streaks = boardResults.flatMap((r) => r.streaks);
		const reminders = boardResults.flatMap((r) => r.reminders);
		const newItemCounts = boardResults
			.map((r) => r.itemCounts)
			.filter((c) => c.total > 0);

		// Fetch "On This Day" memories for current user
		let memories: MemoryDoc[] = [];
		if (uid) {
			const today = new Date().toISOString().slice(0, 10);
			const memoriesSnap = await getDocs(query(
				collection(db, 'users', uid, 'memories'),
				where('date', '==', today),
				orderBy('daysAgo', 'asc')
			));
			memories = memoriesSnap.docs.map(d => ({ ...d.data() }) as MemoryDoc);
		}

		if (requestId !== activeRequestId) return; // newer request superseded this one
		todayStore.set({
			loading: false,
			error: null,
			briefings,
			recentVoiceNotes,
			streaks,
			reminders,
			newItemCounts,
			memories
		});
	} catch (err) {
		if (requestId !== activeRequestId) return;
		console.error('loadTodayData failed:', err);
		todayStore.update((s) => ({
			...s,
			loading: false,
			error: err instanceof Error ? err.message : 'Could not load today\'s data'
		}));
	}
}
