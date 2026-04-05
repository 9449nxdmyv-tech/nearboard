/**
 * @file cleanupTtsCache.ts
 * @description Weekly scheduled function that cleans up old TTS audio files
 *              and briefing documents older than 14 days to prevent unbounded
 *              storage growth.
 */

import '../utils/admin.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const RETENTION_DAYS = 14;
const BATCH_SIZE = 100;

export const cleanupTtsCache = onSchedule('every monday 03:00', async () => {
	const db = getFirestore();
	const bucket = getStorage().bucket();
	const cutoff = Timestamp.fromDate(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));

	// Find all boards
	const boardsSnap = await db.collection('boards').select().get();

	let totalDeleted = 0;
	let totalFilesRemoved = 0;

	for (const boardDoc of boardsSnap.docs) {
		const briefingsRef = db.collection(`boards/${boardDoc.id}/briefings`);

		// Query old briefings
		const oldBriefings = await briefingsRef
			.where('generatedAt', '<', cutoff)
			.limit(BATCH_SIZE)
			.get();

		if (oldBriefings.empty) continue;

		const batch = db.batch();
		for (const doc of oldBriefings.docs) {
			const data = doc.data();

			// Delete audio file from Storage if it exists
			if (data.audioUrl) {
				try {
					const url = data.audioUrl as string;
					// Extract file path from Storage URL
					const match = url.match(/\/o\/(.+?)(\?|$)/);
					if (match) {
						const filePath = decodeURIComponent(match[1]);
						await bucket.file(filePath).delete().catch(() => {});
						totalFilesRemoved++;
					} else if (url.includes('storage.googleapis.com')) {
						// Public URL format: https://storage.googleapis.com/bucket/path
						const bucketName = bucket.name;
						const pathStart = url.indexOf(bucketName);
						if (pathStart !== -1) {
							const filePath = url.slice(pathStart + bucketName.length + 1);
							await bucket.file(filePath).delete().catch(() => {});
							totalFilesRemoved++;
						}
					}
				} catch {
					// File already deleted or path unparseable — continue
				}
			}

			batch.delete(doc.ref);
			totalDeleted++;
		}

		await batch.commit();
	}

	// Also clean up old TTS cache files in Storage (boards/*/briefings/*.mp3)
	try {
		const [files] = await bucket.getFiles({ prefix: 'boards/', delimiter: '' });
		const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

		for (const file of files) {
			if (!file.name.includes('/briefings/') || !file.name.endsWith('.mp3')) continue;

			const [metadata] = await file.getMetadata();
			const created = new Date(metadata.timeCreated as string);
			if (created < cutoffDate) {
				await file.delete().catch(() => {});
				totalFilesRemoved++;
			}
		}
	} catch (err) {
		console.error('TTS file cleanup failed:', err);
	}

	if (totalDeleted > 0 || totalFilesRemoved > 0) {
		console.info(`TTS cleanup: ${totalDeleted} briefing docs deleted, ${totalFilesRemoved} audio files removed`);
	}
});
