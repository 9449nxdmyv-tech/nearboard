/**
 * @file aiService.ts
 * @description Groq API wrapper for AI briefing generation (Llama 3.3 70B).
 *              Free tier: 6,000 req/day, 6,000 tokens/min.
 */

import Groq from 'groq-sdk';

let _groq: Groq | null = null;

function getGroq(): Groq {
	if (!_groq) {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey) throw new Error('GROQ_API_KEY secret is not set');
		_groq = new Groq({ apiKey });
	}
	return _groq;
}

const BRIEFING_PROMPT_TEMPLATE = `You are Nearboard's friendly AI assistant. A shared board called "{boardName}" was just updated by {memberNames}.

Changes made:
{changesDiff}

Write a warm, conversational 2-sentence briefing (max 40 words) summarizing what's new. Use first names. Sound like a helpful friend, not a robot. If it's a product, mention the name and price. If it's a list update, say what was added.`;

interface BriefingInput {
	boardName: string;
	memberNames: string;
	changesDiff: string;
}

/**
 * Generates a short AI briefing summarizing recent board changes.
 */
export async function generateBriefing(input: BriefingInput): Promise<string> {
	try {
		const prompt = BRIEFING_PROMPT_TEMPLATE
			.replace('{boardName}', input.boardName)
			.replace('{memberNames}', input.memberNames)
			.replace('{changesDiff}', input.changesDiff);

		const completion = await getGroq().chat.completions.create({
			model: 'llama-3.3-70b-versatile',
			messages: [{ role: 'user', content: prompt }],
			max_tokens: 100
		});

		return completion.choices[0]?.message?.content ?? '';
	} catch (err) {
		console.error('Groq briefing generation failed:', err);
		return '';
	}
}

/**
 * Generic text generation helper for other services (wrapped, reminders, etc.)
 */
export async function generateText(prompt: string, maxTokens = 200): Promise<string> {
	try {
		const completion = await getGroq().chat.completions.create({
			model: 'llama-3.3-70b-versatile',
			messages: [{ role: 'user', content: prompt }],
			max_tokens: maxTokens
		});

		return completion.choices[0]?.message?.content ?? '';
	} catch (err) {
		console.error('Groq text generation failed:', err);
		return '';
	}
}
