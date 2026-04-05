/**
 * @file api/route-board/+server.ts
 * @description Server endpoint for AI-powered board routing (T4).
 *              Receives scrubbed content + board summaries, asks Groq which
 *              board is the best match. Keeps Groq API key server-side.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GROQ_API_KEY } from '$env/static/private';
import Groq from 'groq-sdk';
import { createRateLimiter } from '$lib/api/rateLimiter';

const groq = new Groq({ apiKey: GROQ_API_KEY });

const { isRateLimited } = createRateLimiter({ max: 20 });

interface RouteRequestBoard {
	id: string;
	name: string;
	summary: string;
}

interface RouteRequestBody {
	content: string;
	boards: RouteRequestBoard[];
}

const SYSTEM_PROMPT = `You route content to the best-matching board. Each board has a name and a summary describing its topic/purpose.

Given the content and the available boards, respond with ONLY a JSON object:
{"boardId":"...","confidence":"high"|"medium"}

Rules:
- "high" = content clearly belongs to one board (topic match, obvious fit)
- "medium" = content could fit but it's not a strong match
- If no board is a good fit, pick the closest and use "medium"
- ONLY output the JSON object, nothing else`;

function buildPrompt(content: string, boards: RouteRequestBoard[]): string {
	const boardList = boards
		.map((b) => `- Board "${b.name}" (id: ${b.id}): ${b.summary}`)
		.join('\n');

	return `Content to route:\n"${content.slice(0, 500)}"\n\nAvailable boards:\n${boardList}`;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (isRateLimited(ip)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	if (!GROQ_API_KEY) {
		return json({ error: 'Groq API key not configured' }, { status: 500 });
	}

	let body: RouteRequestBody;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { content, boards } = body;

	if (!content || typeof content !== 'string') {
		return json({ error: 'Missing content' }, { status: 400 });
	}
	if (!Array.isArray(boards) || boards.length === 0 || boards.length > 10) {
		return json({ error: 'boards must be 1-10 items' }, { status: 400 });
	}

	// Validate board shape
	for (const b of boards) {
		if (!b.id || !b.name || !b.summary) {
			return json({ error: 'Each board must have id, name, and summary' }, { status: 400 });
		}
	}

	try {
		const completion = await groq.chat.completions.create({
			model: 'llama-3.3-70b-versatile',
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: buildPrompt(content, boards) }
			],
			temperature: 0.1,
			max_tokens: 60
		});

		const raw = completion.choices[0]?.message?.content ?? '';
		const jsonMatch = raw.match(/\{[\s\S]*?\}/); // Non-greedy to avoid matching multiple objects
		if (!jsonMatch) {
			return json({ boardId: boards[0].id, confidence: 'medium' });
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(jsonMatch[0]);
		} catch {
			return json({ boardId: boards[0].id, confidence: 'medium' });
		}

		// Validate response shape
		if (typeof parsed.boardId !== 'string' || typeof parsed.confidence !== 'string') {
			return json({ boardId: boards[0].id, confidence: 'medium' });
		}

		// Validate the response references a real board
		const validBoard = boards.find((b) => b.id === parsed.boardId);
		if (!validBoard) {
			return json({ boardId: boards[0].id, confidence: 'medium' });
		}

		const confidence = parsed.confidence === 'high' ? 'high' : 'medium';
		return json({ boardId: validBoard.id, confidence });
	} catch (err) {
		console.error('Board routing AI failed:', err);
		// Graceful degradation — return first board as medium confidence
		return json({ boardId: boards[0].id, confidence: 'medium' });
	}
};
