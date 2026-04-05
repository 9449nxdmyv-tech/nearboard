/**
 * @file digestBuilder.ts
 * @description Shared logic for building a user's email digest data.
 *              Used by both the scheduled emailDigest and the sendDigestPreview callable.
 */

import { createHmac } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { generateText } from './aiService.js';
import type { DigestBoardSection, DigestEmailData } from './emailService.js';

const APP_BASE_URL = 'https://nearboard-app.web.app';

export { APP_BASE_URL };

interface BuildDigestOptions {
	uid: string;
	email: string;
	displayName: string;
	/** Cutoff timestamp — only include content created after this. */
	since: Timestamp;
}

/**
 * Builds digest email data for a single user. Returns null if there's nothing to send.
 */
export async function buildDigestForUser(options: BuildDigestOptions): Promise<DigestEmailData | null> {
	const { uid, email, displayName, since } = options;
	const db = getFirestore();

	// Find all boards this user is currently a member of
	const boardsSnap = await db
		.collection('boards')
		.where('memberIds', 'array-contains', uid)
		.get();

	if (boardsSnap.empty) return null;

	const boardSections: DigestBoardSection[] = [];
	const quietBoards: Array<{ name: string; daysQuiet: number }> = [];

	for (const boardDoc of boardsSnap.docs) {
		const board = boardDoc.data() as { 
			name: string; 
			memberIds: string[]; 
			livingSummary?: { content: string };
			lastActivityAt?: Timestamp;
		};

		// Verify membership at send time via member subcollection
		const memberSnap = await db.doc(`boards/${boardDoc.id}/members/${uid}`).get();
		if (!memberSnap.exists) continue;

		// Skip boards the user has muted from digest
		const memberData = memberSnap.data();
		if (memberData?.digestMuted === true) continue;

		// Check for quiet boards (Lever 5 — ambient signals)
		const lastActivity = board.lastActivityAt;
		if (lastActivity) {
			const daysSinceActivity = Math.floor(
				(Date.now() - lastActivity.toMillis()) / (1000 * 60 * 60 * 24)
			);
			if (daysSinceActivity >= 7) {
				quietBoards.push({
					name: board.name,
					daysQuiet: daysSinceActivity
				});
			}
		}

		const contentSnap = await db
			.collection(`boards/${boardDoc.id}/content`)
			.where('createdAt', '>', since)
			.where('moderationStatus', '==', 'approved')
			.orderBy('createdAt', 'desc')
			.limit(20)
			.get();

		if (contentSnap.empty) continue;

		const cards = contentSnap.docs.map((d) => {
			const c = d.data();
			return {
				title: getCardTitle(c),
				type: (c.type as string) || 'note',
				authorName: (c.authorName as string) || 'Someone'
			};
		});

		boardSections.push({
			boardId: boardDoc.id,
			boardName: board.name,
			cards: cards.slice(0, 3),
			totalNewCards: contentSnap.size
		});
	}

	if (boardSections.length === 0 && quietBoards.length === 0) return null;

	// Generate AI insight from living summaries
	const aiInsight = await generateDigestInsight(boardSections, boardsSnap, quietBoards);
	const unsubscribeUrl = generateUnsubscribeUrl(uid);

	return {
		toEmail: email,
		userName: displayName,
		boards: boardSections,
		aiInsight,
		unsubscribeUrl,
		appBaseUrl: APP_BASE_URL,
		quietBoards: quietBoards.length > 0 ? quietBoards : undefined
	};
}

/**
 * Extracts a display title from a content document based on its type.
 */
function getCardTitle(data: Record<string, unknown>): string {
	switch (data.type) {
		case 'note':
			return truncate((data.text as string) || 'Note', 60);
		case 'list':
			return (data.title as string) || 'List';
		case 'link':
		case 'product':
			return (data.title as string) || (data.url as string) || 'Link';
		case 'voice':
			return 'Voice note';
		case 'photo':
			return (data.caption as string) || 'Photo';
		case 'video':
			return (data.caption as string) || 'Video';
		case 'location':
			return (data.name as string) || (data.address as string) || 'Location';
		case 'poll':
			return (data.question as string) || 'Poll';
		default:
			return 'New card';
	}
}

function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

async function generateDigestInsight(
	sections: DigestBoardSection[],
	boardsSnap: FirebaseFirestore.QuerySnapshot,
	quietBoards: Array<{ name: string; daysQuiet: number }> = []
): Promise<string> {
	const summaries: string[] = [];
	for (const boardDoc of boardsSnap.docs) {
		const board = boardDoc.data();
		const livingSummary = board.livingSummary as { content?: string } | undefined;
		if (livingSummary?.content) {
			summaries.push(`${board.name}: ${livingSummary.content}`);
		}
	}

	const totalCards = sections.reduce((sum, s) => sum + s.totalNewCards, 0);
	if (totalCards === 0 && quietBoards.length === 0) return '';

	const boardNames = sections.map((s) => s.boardName).join(', ');

	// Build context from living summaries or fall back to section card counts
	let boardContext: string;
	if (summaries.length > 0) {
		boardContext = `Board summaries:\n${summaries.join('\n')}`;
	} else {
		// No living summaries — derive type counts from cards
		const breakdown = sections.map((s) => {
			const typeCounts: Record<string, number> = {};
			for (const card of s.cards) {
				typeCounts[card.type] = (typeCounts[card.type] || 0) + 1;
			}
			const types = Object.entries(typeCounts)
				.map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
				.join(', ');
			return `${s.boardName}: ${types || `${s.totalNewCards} new items`}`;
		}).join('\n');
		boardContext = `Board activity:\n${breakdown}`;
	}

	let prompt = `You are Nearboard's digest assistant. The user has ${totalCards} new cards across boards: ${boardNames}.

${boardContext}
`;

	if (quietBoards.length > 0) {
		const quietList = quietBoards
			.map((q) => `${q.name} (${q.daysQuiet} days quiet)`)
			.join('\n');
		prompt += `\nQuiet boards (no recent activity):\n${quietList}\n`;
	}

	prompt += `
Write a 1-2 sentence friendly insight (max 30 words) highlighting the most interesting trend or action item across these boards. Sound warm and helpful.`;

	return generateText(prompt, 60);
}

export function generateUnsubscribeUrl(uid: string): string {
	const secret = process.env.DIGEST_HMAC_SECRET;
	if (!secret) return `${APP_BASE_URL}/profile`;

	const token = createHmac('sha256', secret).update(uid).digest('hex');
	return `${APP_BASE_URL}/api/digest-unsubscribe?uid=${uid}&token=${token}`;
}
