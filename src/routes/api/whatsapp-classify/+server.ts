/**
 * @file api/whatsapp-classify/+server.ts
 * @description Server endpoint for WhatsApp message classification via Groq LLM.
 *              Keeps Groq API key server-side. Scrubs PII before sending to LLM.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GROQ_API_KEY } from '$env/static/private';
import Groq from 'groq-sdk';
import type { ParsedWhatsAppMessage, ClassifiedWhatsAppCard } from '$lib/types';
import { WHATSAPP_IMPORT_LLM_CHUNK_SIZE, WHATSAPP_IMPORT_MAX_CARDS } from '$lib/config/constants';
import { createRateLimiter } from '$lib/api/rateLimiter';

const groq = new Groq({ apiKey: GROQ_API_KEY });

const { isRateLimited } = createRateLimiter({ max: 10 });

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
			? ` [attachments: ${m.attachments.map((a) => `${a.filename} (${a.mimeHint})`).join(', ')}]`
			: '';
		return `[${i}] ${m.author}: ${text}${attachLabel}`;
	});
	return `Classify these ${messages.length} WhatsApp messages:\n\n${lines.join('\n')}`;
}

async function classifyChunk(messages: ParsedWhatsAppMessage[]): Promise<(ClassifiedWhatsAppCard | null)[]> {
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

	// Extract JSON array from response (LLM may wrap in markdown code fences)
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

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (isRateLimited(ip)) {
		return json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
	}

	if (!GROQ_API_KEY) {
		return json({ error: 'Groq API key not configured' }, { status: 500 });
	}

	let body: { messages: ParsedWhatsAppMessage[] };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { messages } = body;
	if (!Array.isArray(messages) || messages.length === 0) {
		return json({ error: 'No messages provided' }, { status: 400 });
	}

	// Cap input to prevent abuse
	const capped = messages.slice(0, WHATSAPP_IMPORT_MAX_CARDS * 2);

	const results: (ClassifiedWhatsAppCard | null)[] = [];

	// Process in chunks for Groq rate limits
	for (let i = 0; i < capped.length; i += WHATSAPP_IMPORT_LLM_CHUNK_SIZE) {
		const chunk = capped.slice(i, i + WHATSAPP_IMPORT_LLM_CHUNK_SIZE);
		try {
			const classified = await classifyChunk(chunk);
			results.push(...classified);
		} catch (err) {
			console.error('Groq classification chunk failed:', err);
			// Push nulls for failed chunk — don't block the rest
			results.push(...chunk.map(() => null));
		}
	}

	// Filter out nulls and cap total cards
	const cards = results.filter((c): c is ClassifiedWhatsAppCard => c !== null).slice(0, WHATSAPP_IMPORT_MAX_CARDS);

	return json({ cards });
};
