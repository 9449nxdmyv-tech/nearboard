/**
 * @file nearboardWrapped.ts
 * @description Annual scheduled function (December 1st) that generates per-board
 *              year-in-review stats and a narrative summary using Groq AI.
 *              Supports an optional `tone` field (e.g. "casual", "poetic", "hype")
 *              which defaults to "warm and friendly". Stored on the wrapped doc.
 * @todos
 *   - MED UX: Generate a shareable image card (9:16 aspect ratio for Stories)
 */

import '../utils/admin.js';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { generateText } from '../utils/aiService.js';

export const nearboardWrapped = onSchedule({ schedule: '0 0 1 12 *', secrets: ['GROQ_API_KEY'] }, async () => {
	const db = getFirestore();
	const year = new Date().getFullYear();

	const boardsSnap = await db.collection('boards').get();

	for (const boardDoc of boardsSnap.docs) {
		const boardData = boardDoc.data();
		const boardName = boardData.name as string;

		// Gather stats for the year
		const yearStart = new Date(year, 0, 1);
		const contentSnap = await db
			.collection(`boards/${boardDoc.id}/content`)
			.where('createdAt', '>=', yearStart)
			.get();

		if (contentSnap.empty) continue;

		let notesWritten = 0;
		let listsCreated = 0;
		let linksClipped = 0;
		let productsSaved = 0;
		let voiceNotesRecorded = 0;
		let photosShared = 0;
		let videosShared = 0;
		let locationsShared = 0;
		let pollsCreated = 0;
		const memberActivity: Record<string, { name: string; count: number }> = {};

		for (const doc of contentSnap.docs) {
			const data = doc.data();
			if (data.type === 'note') notesWritten++;
			if (data.type === 'list') listsCreated++;
			if (data.type === 'link') linksClipped++;
			if (data.type === 'product') productsSaved++;
			if (data.type === 'voice') voiceNotesRecorded++;
			if (data.type === 'photo') photosShared++;
			if (data.type === 'video') videosShared++;
			if (data.type === 'location') locationsShared++;
			if (data.type === 'poll') pollsCreated++;

			const authorId = data.authorId as string;
			const authorName = data.authorName as string;
			if (!memberActivity[authorId]) {
				memberActivity[authorId] = { name: authorName, count: 0 };
			}
			memberActivity[authorId].count++;
		}

		const mostActive = Object.entries(memberActivity).sort(
			(a, b) => b[1].count - a[1].count
		)[0];

		const stats = {
			boardId: boardDoc.id,
			year,
			itemsAdded: contentSnap.size,
			notesWritten,
			listsCreated,
			linksClipped,
			productsSaved,
			voiceNotesRecorded,
			photosShared,
			videosShared,
			locationsShared,
			pollsCreated,
			mostActiveMember: {
				uid: mostActive[0],
				name: mostActive[1].name,
				count: mostActive[1].count
			},
			longestStreak: (boardData.streak as number) ?? 0
		};

		// Check for an existing wrapped doc that may have a user-selected tone
		const existingWrapped = await db.doc(`boards/${boardDoc.id}/wrapped/${year}`).get();
		const tone: string = (existingWrapped.data()?.tone as string) || 'warm and friendly';

		const prompt = `You are writing a ${tone}, celebratory year-in-review for a shared board called "${boardName}".

Stats for ${year}:
- ${stats.itemsAdded} items added total
- ${stats.notesWritten} notes written
- ${stats.listsCreated} lists created
- ${stats.linksClipped} links clipped
- ${stats.productsSaved} products saved
- ${stats.voiceNotesRecorded} voice notes recorded
- ${stats.photosShared} photos shared
- ${stats.videosShared} videos shared
- ${stats.locationsShared} locations pinned
- ${stats.pollsCreated} polls created
- Most active member: ${stats.mostActiveMember.name} (${stats.mostActiveMember.count} items)
- Longest streak: ${stats.longestStreak} days

Write a ${tone}, celebratory 3-sentence paragraph (max 60 words) summarizing the year. Use the member's first name. Sound like a proud friend reflecting on shared memories.`;

		const narrative = await generateText(prompt, 150);

		await db.doc(`boards/${boardDoc.id}/wrapped/${year}`).set({
			...stats,
			narrative,
			tone,
			generatedAt: FieldValue.serverTimestamp()
		});
	}
});
