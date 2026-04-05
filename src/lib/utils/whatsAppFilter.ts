/**
 * @file whatsAppFilter.ts
 * @description Hard-filters noise from parsed WhatsApp messages before LLM classification.
 *              Pure function — no side effects.
 */

import type { ParsedWhatsAppMessage } from '$lib/types';
import { WHATSAPP_IMPORT_MIN_MSG_LENGTH, WHATSAPP_IMPORT_RECENCY_DAYS } from '$lib/config/constants';

/**
 * Emoji-only detection: returns true if text is only emoji + whitespace.
 * Covers most common emoji ranges including modifiers and ZWJ sequences.
 */
export function isEmojiOnly(text: string): boolean {
	const stripped = text.replace(/\s+/g, '');
	if (!stripped) return true;
	// Remove all emoji codepoints and see if anything remains
	const withoutEmoji = stripped.replace(
		/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{FE0F}\u{200B}-\u{200D}\u{2028}\u{2029}]/gu,
		''
	);
	return withoutEmoji.length === 0;
}

/** Returns true if text contains a URL */
export function containsUrl(text: string): boolean {
	return /https?:\/\/[^\s]+/i.test(text);
}

/** Returns true if text contains a recognizable date pattern */
export function containsDatePattern(text: string): boolean {
	return /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(text) ||
		/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text);
}

/** Returns true if text looks like a list (bulleted or numbered) */
export function containsListPattern(text: string): boolean {
	return /(?:^|\n)\s*[-•*]\s+\S/m.test(text) ||
		/(?:^|\n)\s*\d+[.)]\s+\S/m.test(text);
}

/** Returns true if text is a WhatsApp reaction message */
export function isReactionMessage(text: string): boolean {
	// WhatsApp shows reactions like: "You reacted 👍 to "message""
	return /^.{0,30}reacted\s+.{1,10}\s+to\s+"/i.test(text);
}

/**
 * Filters parsed messages, removing noise before LLM classification.
 * Applies hard exclusion rules in order.
 */
export function filterMessages(messages: ParsedWhatsAppMessage[]): ParsedWhatsAppMessage[] {
	const cutoff = Date.now() - WHATSAPP_IMPORT_RECENCY_DAYS * 86_400_000;

	return messages.filter((msg) => {
		// 0. Messages older than 30 days
		if (new Date(msg.timestamp).getTime() < cutoff) return false;

		// 1. System messages
		if (msg.isSystemMessage) return false;

		// 2. GIF attachments (only attachment, no meaningful text)
		if (msg.attachments.some((a) => a.mimeHint === 'gif')) return false;

		// 3. Media omitted with no other content
		if (/^<Media omitted>$/i.test(msg.text.trim())) return false;

		// 4. Emoji-only messages
		if (isEmojiOnly(msg.text)) return false;

		// 5. Reaction messages
		if (isReactionMessage(msg.text)) return false;

		// 6. Short messages without signal
		const textLen = msg.text.replace(/<Media omitted>/gi, '').trim().length;
		if (textLen < WHATSAPP_IMPORT_MIN_MSG_LENGTH && !containsUrl(msg.text) && !containsDatePattern(msg.text) && !containsListPattern(msg.text) && msg.attachments.length === 0) {
			return false;
		}

		return true;
	});
}
