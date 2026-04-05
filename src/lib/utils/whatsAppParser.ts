/**
 * @file whatsAppParser.ts
 * @description Parses exported WhatsApp .txt chat files into structured messages.
 *              Pure synchronous function — no side effects, never throws.
 */

import type { ParsedWhatsAppMessage } from '$lib/types';

/** System message keywords — these are WhatsApp control/info messages */
const SYSTEM_KEYWORDS = [
	'joined using',
	'end-to-end encrypted',
	'changed the subject',
	'changed the group',
	'changed this group',
	'added',
	'removed',
	'left',
	'created group',
	'security code changed',
	'messages and calls are end-to-end encrypted',
	'you were added',
	'you\'re now an admin',
	'disappeared'
];

/**
 * WhatsApp date-time + author line patterns.
 * Captures: [1] date, [2] time (with optional AM/PM), [3] author, [4] text
 */
const LINE_PATTERNS = [
	// [DD/MM/YYYY, HH:MM:SS] Author: text
	/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\]\s*([^:]+):\s*([\s\S]*)$/,
	// DD/MM/YYYY, HH:MM:SS - Author: text
	/^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\s*-\s*([^:]+):\s*([\s\S]*)$/,
	// System message variants (no author)
	// [DD/MM/YYYY, HH:MM:SS] system text
	/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\]\s*([\s\S]*)$/,
	// DD/MM/YYYY, HH:MM:SS - system text
	/^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\s*-\s*([\s\S]*)$/
];

/** Attachment detection: WhatsApp marks attachments with these patterns */
const ATTACHMENT_RE = /([^\s]+)\s*\(file attached\)/gi;
const MEDIA_OMITTED_RE = /<Media omitted>/i;

/** Infer MIME hint from file extension */
function inferMimeHint(filename: string): 'image' | 'gif' | 'video' | 'document' | 'unknown' {
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif'].includes(ext)) return 'image';
	if (ext === 'gif') return 'gif';
	if (['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext)) return 'video';
	if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'].includes(ext)) return 'document';
	return 'unknown';
}

/**
 * Parses a date string from WhatsApp (DD/MM/YYYY or MM/DD/YYYY) + time into an ISO string.
 * Uses heuristics: if first number > 12, it must be DD/MM format.
 */
function parseDateTime(dateStr: string, timeStr: string): string {
	const parts = dateStr.split('/').map((p) => parseInt(p, 10));
	if (parts.length !== 3) return new Date().toISOString();

	let [a, b, year] = parts;
	if (year < 100) year += 2000;

	// Heuristic: if first part > 12, it's DD/MM/YYYY
	let month: number, day: number;
	if (a > 12) {
		day = a;
		month = b;
	} else if (b > 12) {
		month = a;
		day = b;
	} else {
		// Ambiguous — assume DD/MM (WhatsApp default in most locales)
		day = a;
		month = b;
	}

	// Parse time, handling AM/PM
	let timeCleaned = timeStr.trim();
	const isPM = /pm/i.test(timeCleaned);
	const isAM = /am/i.test(timeCleaned);
	timeCleaned = timeCleaned.replace(/\s*[APap][Mm]/g, '');

	const timeParts = timeCleaned.split(':').map((p) => parseInt(p, 10));
	let hours = timeParts[0] ?? 0;
	const minutes = timeParts[1] ?? 0;
	const seconds = timeParts[2] ?? 0;

	if (isPM && hours < 12) hours += 12;
	if (isAM && hours === 12) hours = 0;

	try {
		const d = new Date(year, month - 1, day, hours, minutes, seconds);
		if (isNaN(d.getTime())) return new Date().toISOString();
		return d.toISOString();
	} catch {
		return new Date().toISOString();
	}
}

function isSystemMessage(text: string): boolean {
	const lower = text.toLowerCase();
	return SYSTEM_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Parses a WhatsApp exported chat .txt into structured messages.
 * Never throws — skips malformed lines and returns what parsed successfully.
 */
export function parseChat(text: string): ParsedWhatsAppMessage[] {
	const lines = text.split('\n');
	const messages: ParsedWhatsAppMessage[] = [];
	let current: ParsedWhatsAppMessage | null = null;

	for (const line of lines) {
		let matched = false;

		// Try author-line patterns first (4 capture groups)
		for (const pattern of LINE_PATTERNS) {
			const m = line.match(pattern);
			if (!m) continue;

			// Flush previous message
			if (current) messages.push(current);

			if (m.length >= 5) {
				// Pattern with author: date, time, author, text
				const dateStr = m[1];
				const timeStr = m[2];
				const author = m[3].trim();
				const msgText = m[4];

				const attachments: ParsedWhatsAppMessage['attachments'] = [];
				let cleanText = msgText;

				// Detect attachments
				let attachMatch;
				ATTACHMENT_RE.lastIndex = 0;
				while ((attachMatch = ATTACHMENT_RE.exec(msgText)) !== null) {
					attachments.push({
						filename: attachMatch[1],
						mimeHint: inferMimeHint(attachMatch[1])
					});
				}

				// If text is only "<Media omitted>", mark it
				if (MEDIA_OMITTED_RE.test(cleanText) && cleanText.replace(MEDIA_OMITTED_RE, '').trim() === '') {
					cleanText = '<Media omitted>';
				}

				current = {
					timestamp: parseDateTime(dateStr, timeStr),
					author,
					text: cleanText.trim(),
					attachments,
					isSystemMessage: false
				};
			} else {
				// System message pattern: date, time, text (no author)
				const dateStr = m[1];
				const timeStr = m[2];
				const msgText = m[3];

				current = {
					timestamp: parseDateTime(dateStr, timeStr),
					author: '',
					text: msgText.trim(),
					attachments: [],
					isSystemMessage: true
				};
			}

			matched = true;
			break;
		}

		// Multi-line continuation
		if (!matched && current) {
			current.text += '\n' + line;
		}
	}

	// Flush last message
	if (current) messages.push(current);

	// Post-process: detect system messages by content
	for (const msg of messages) {
		if (!msg.isSystemMessage && (!msg.author || isSystemMessage(msg.text))) {
			msg.isSystemMessage = true;
		}
	}

	return messages;
}
