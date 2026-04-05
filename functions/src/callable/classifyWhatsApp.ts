/**
 * @file classifyWhatsApp.ts
 * @description HTTPS callable Cloud Function for WhatsApp message classification
 *              via Groq LLM. Replaces the SvelteKit server endpoint which doesn't
 *              work with adapter-static.
 */

import '../utils/admin.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Groq from 'groq-sdk';

interface ParsedWhatsAppMessage {
	author: string;
	text: string;
	timestamp: string;
	attachments: { filename: string; mimeHint: string }[];
}

interface ClassifiedWhatsAppCard {
	originalMessage: ParsedWhatsAppMessage;
	cardType: 'link' | 'product' | 'note' | 'list' | 'photo';
	proposedTitle: string;
	proposedContent: string;
	proposedUrl?: string;
	proposedDate?: string;
	confidence: 'high' | 'medium';
}

const LLM_CHUNK_SIZE = 30;
const MAX_CARDS = 200;

/** Strip phone numbers and emails from text before sending to LLM */
function scrubPII(text: string): string {
	return text
		.replace(/\+?\d[\d\s\-()]{8,}/g, '[phone]')
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

const SYSTEM_PROMPT = `You classify WhatsApp messages into board cards. For each message, output a JSON object or null (if not worth saving).

Card types:
- "link": message contains a URL worth bookmarking
- "product": message contains a product URL or recommendation with price/store mention
- "note": useful information, recommendation, reminder, or idea worth preserving
- "list": message contains multiple items (to-do, shopping, steps, etc.)
- "photo": message has an image attachment worth keeping

Rules:
- Skip greetings, small talk, thank-yous, status updates ("on my way"), and filler
- Only classify as "high" confidence if the card is clearly valuable; use "medium" otherwise
- proposedTitle: short descriptive title (max 60 chars)
- proposedContent: the key information from the message
- proposedUrl: extract URL if present
- For lists: proposedContent should be items separated by newlines, each starting with "- "

Respond with a JSON array. Each element is either a card object or null (skip). Array length MUST match input length.

Card object shape:
{"cardType":"note","proposedTitle":"...","proposedContent":"...","confidence":"high"}
{"cardType":"link","proposedTitle":"...","proposedContent":"...","proposedUrl":"https://...","confidence":"high"}`;

function buildPrompt(messages: ParsedWhatsAppMessage[]): string {
	const lines = messages.map((m, i) => {
		const text = scrubPII(m.text);
		const attachLabel = m.attachments.length > 0
			? ` [attachments: ${m.attachments.map((a: { filename: string; mimeHint: string }) => `${a.filename} (${a.mimeHint})`).join(', ')}]`
			: '';
		return `[${i}] ${m.author}: ${text}${attachLabel}`;
	});
	return `Classify these ${messages.length} WhatsApp messages:\n\n${lines.join('\n')}`;
}

async function classifyChunk(
	groq: Groq,
	messages: ParsedWhatsAppMessage[]
): Promise<(ClassifiedWhatsAppCard | null)[]> {
	const prompt = buildPrompt(messages);

	const completion = await groq.chat.completions.create({
		model: 'llama-3.3-70b-versatile',
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: prompt }
		],
		temperature: 0.1,
		max_tokens: 4000
	});

	const raw = completion.choices[0]?.message?.content ?? '[]';

	const jsonMatch = raw.match(/\[[\s\S]*\]/);
	if (!jsonMatch) return messages.map(() => null);

	let parsed: unknown[];
	try {
		parsed = JSON.parse(jsonMatch[0]);
	} catch {
		return messages.map(() => null);
	}

	return messages.map((msg, i) => {
		const item = parsed[i];
		if (!item || typeof item !== 'object') return null;

		const card = item as Record<string, unknown>;
		const cardType = card.cardType as string;
		if (!['link', 'product', 'note', 'list', 'photo'].includes(cardType)) return null;

		const confidence = card.confidence as string;
		if (!['high', 'medium'].includes(confidence)) return null;

		return {
			originalMessage: msg,
			cardType: cardType as ClassifiedWhatsAppCard['cardType'],
			proposedTitle: String(card.proposedTitle ?? '').slice(0, 100),
			proposedContent: String(card.proposedContent ?? ''),
			proposedUrl: typeof card.proposedUrl === 'string' ? card.proposedUrl : undefined,
			proposedDate: typeof card.proposedDate === 'string' ? card.proposedDate : undefined,
			confidence: confidence as 'high' | 'medium'
		};
	});
}

export const classifyWhatsApp = onCall(
	{ secrets: ['GROQ_API_KEY'], timeoutSeconds: 300, memory: '512MiB' },
	async (request) => {
		if (!request.auth) {
			throw new HttpsError('unauthenticated', 'Must be signed in');
		}

		const key = process.env.GROQ_API_KEY;
		if (!key) {
			console.error('GROQ_API_KEY secret is not set');
			throw new HttpsError('internal', 'Groq API key not configured');
		}

		const { messages } = request.data as { messages: ParsedWhatsAppMessage[] };
		if (!Array.isArray(messages) || messages.length === 0) {
			throw new HttpsError('invalid-argument', 'No messages provided');
		}

		console.log(`classifyWhatsApp: processing ${messages.length} messages`);

		try {
			const groq = new Groq({ apiKey: key });
			const capped = messages.slice(0, MAX_CARDS * 2);
			const results: (ClassifiedWhatsAppCard | null)[] = [];

			for (let i = 0; i < capped.length; i += LLM_CHUNK_SIZE) {
				const chunk = capped.slice(i, i + LLM_CHUNK_SIZE);
				const chunkNum = Math.floor(i / LLM_CHUNK_SIZE) + 1;
				const totalChunks = Math.ceil(capped.length / LLM_CHUNK_SIZE);
				console.log(`classifyWhatsApp: processing chunk ${chunkNum}/${totalChunks} (${chunk.length} messages)`);
				try {
					const classified = await classifyChunk(groq, chunk);
					results.push(...classified);
				} catch (err) {
					console.error(`Groq classification chunk ${chunkNum} failed:`, err);
					results.push(...chunk.map(() => null));
				}
			}

			const cards = results
				.filter((c): c is ClassifiedWhatsAppCard => c !== null)
				.slice(0, MAX_CARDS);

			console.log(`classifyWhatsApp: returning ${cards.length} cards`);
			return { cards };
		} catch (err) {
			console.error('classifyWhatsApp top-level error:', err);
			throw new HttpsError('internal', 'Classification failed. Please try again.');
		}
	}
);
