/**
 * @file ttsService.ts
 * @description Google Cloud Text-to-Speech wrapper for voice briefings.
 *              Converts briefing text to speech audio (MP3). All TTS logic lives here.
 *              Caches identical text-to-audio conversions in Storage to reduce API calls.
 *              Uses Google Cloud TTS (free tier: 4M chars/month standard, 1M WaveNet).
 */

import { createHash } from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

let ttsClient: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
	if (!ttsClient) ttsClient = new TextToSpeechClient();
	return ttsClient;
}

/**
 * Converts text to speech audio using Google Cloud TTS.
 * Returns the audio as a Buffer (mp3 format).
 *
 * Caches results in Storage by text hash to avoid redundant API calls.
 * Optional boardId parameter enables per-board cache paths.
 */
export async function generateAudio(text: string, boardId?: string): Promise<Buffer | null> {
	// Check cache: hash the input text and look for existing file in Storage
	const textHash = createHash('sha256').update(text).digest('hex');
	const cachePath = boardId
		? `boards/${boardId}/briefings/${textHash}.mp3`
		: `briefings/cache/${textHash}.mp3`;

	const bucket = getStorage().bucket();
	const cachedFile = bucket.file(cachePath);

	try {
		const [exists] = await cachedFile.exists();
		if (exists) {
			const [buffer] = await cachedFile.download();
			return buffer;
		}
	} catch {
		// Cache check failed — proceed to generate fresh audio
	}

	try {
		const client = getClient();
		const [response] = await client.synthesizeSpeech({
			input: { text },
			voice: {
				languageCode: 'en-US',
				name: 'en-US-Neural2-C',
				ssmlGender: 'FEMALE'
			},
			audioConfig: {
				audioEncoding: 'MP3',
				speakingRate: 1.05,
				pitch: 0.5
			}
		});

		if (!response.audioContent) {
			console.error('Google Cloud TTS returned no audio content');
			return null;
		}

		const audioBuffer = Buffer.from(response.audioContent as Uint8Array);

		// Store in cache for future requests
		try {
			await cachedFile.save(audioBuffer, { contentType: 'audio/mpeg' });
			await cachedFile.makePublic();
		} catch (err) {
			console.warn('Failed to cache TTS audio:', err);
		}

		return audioBuffer;
	} catch (err) {
		console.error('Google Cloud TTS error:', err);
		return null;
	}
}
