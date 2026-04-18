/**
 * @file morningDigest.ts
 * @description Scheduled Cloud Function that runs every 30 minutes.
 *              Generates a morning digest briefing for each active board
 *              whose members' local time is ~8am, and sends push notifications.
 *              Uses the Living Summary briefingText as source of truth; only
 *              falls back to a fresh AI call if briefingText is missing.
 *              TTS audio is generated only for morning digests (not per-write).
 */

import '../utils/admin.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { generateAudio } from '../utils/ttsService.js';
import { notifyBoardMembers } from '../utils/fcmService.js';
import { getStorage } from 'firebase-admin/storage';
import { getEligibleBoards, processInBatches } from '../utils/boardEligibility.js';
import { serializeContent } from '../triggers/onBoardContentWrite.js';

const CONCURRENCY_LIMIT = 5;

export const morningDigest = onSchedule({ schedule: 'every 30 minutes', secrets: ['GROQ_API_KEY'] }, async () => {
	const eligibleBoards = await getEligibleBoards({ targetHour: 8 });

	await processInBatches(eligibleBoards, CONCURRENCY_LIMIT, (boardDoc) =>
		processBoardDigest(boardDoc)
	);
});

async function processBoardDigest(
	boardDoc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
	const db = getFirestore();
	const board = boardDoc.data() as {
		name: string;
		memberIds: string[];
		livingSummary?: {
			briefingText?: string;
			content?: string;
			updatedAt?: FirebaseFirestore.Timestamp;
		};
	};

	// ─── Briefing text fallback chain ────────────────────────────────────
	// 1. Living Summary briefingText (already computed, best quality)
	// 2. Living Summary content (re-cast the existing summary as a briefing)
	// 3. Fresh AI call over the last 24h of content
	let briefingText = board.livingSummary?.briefingText?.trim() || '';

	if (!briefingText && board.livingSummary?.content) {
		briefingText = await briefingFromSummary(board.name, board.livingSummary.content);
	}

	if (!briefingText) {
		briefingText = await generateFallbackBriefing(db, boardDoc.id, board.name);
	}

	if (!briefingText) return;

	// Morning digest is the one place we generate TTS audio
	let audioUrl: string | null = null;
	const audioBuffer = await generateAudio(briefingText, boardDoc.id);
	if (audioBuffer) {
		const bucket = getStorage().bucket();
		const filePath = `boards/${boardDoc.id}/briefings/${Date.now()}.mp3`;
		const file = bucket.file(filePath);
		await file.save(audioBuffer, { contentType: 'audio/mpeg' });
		await file.makePublic();
		audioUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
	}

	// Store briefing
	await db.collection(`boards/${boardDoc.id}/briefings`).add({
		boardId: boardDoc.id,
		text: briefingText,
		audioUrl,
		generatedAt: FieldValue.serverTimestamp()
	});

	// Notify members
	await notifyBoardMembers(
		boardDoc.id,
		board.memberIds,
		`Good morning — ${board.name}`,
		briefingText,
		audioUrl
	);
}

/**
 * Condenses an existing Living Summary into a 2-sentence briefing notification.
 * Used when the board has a summary but never generated its own briefingText
 * (e.g., older boards from before briefingText was wired in).
 */
async function briefingFromSummary(boardName: string, summary: string): Promise<string> {
	const { generateText } = await import('../utils/aiService.js');
	const prompt = `Convert this board summary into a warm, conversational 2-sentence morning briefing (max 40 words).
Use first names if present. No markdown. Single line response.

Board: ${boardName}
Summary:
${summary}

Briefing:`;
	const raw = await generateText(prompt, 80);
	return (raw || '').trim().replace(/^Briefing:\s*/i, '').split('\n')[0].trim();
}

/**
 * Fallback briefing generation for boards without a Living Summary at all.
 * Uses the shared serializeContent() so the AI sees the exact same format
 * as the Living Summary pipeline — one canonical serializer.
 */
async function generateFallbackBriefing(
	db: FirebaseFirestore.Firestore,
	boardId: string,
	boardName: string
): Promise<string> {
	const { Timestamp } = await import('firebase-admin/firestore');
	const oneDayAgo = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

	const contentSnap = await db
		.collection(`boards/${boardId}/content`)
		.where('createdAt', '>=', oneDayAgo)
		.orderBy('createdAt', 'desc')
		.limit(15)
		.get();

	if (contentSnap.empty) return '';

	const changes = contentSnap.docs.map((d) => serializeContent(d.data()));

	const memberNames = [...new Set(
		contentSnap.docs.map((d) => (d.data().authorName as string) || 'Someone')
	)].join(', ');

	const { generateBriefing } = await import('../utils/aiService.js');
	return generateBriefing({
		boardName,
		memberNames,
		changesDiff: changes.join('\n')
	});
}
