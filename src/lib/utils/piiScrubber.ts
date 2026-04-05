/**
 * @file piiScrubber.ts
 * @description Strips PII (emails, phone numbers, @mentions) from text before
 *              sending to external AI services. Keeps URL domains but removes
 *              full paths to minimize data exposure.
 */

/** Matches most email addresses */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Matches common phone number formats:
 *   +1-234-567-8901, (234) 567-8901, 234-567-8901, +44 20 7946 0958
 * Requires either a leading +/( or a separator (space/dash) between groups
 * to avoid false positives on version numbers, prices, and plain digit runs.
 */
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/g;

/** Matches @username patterns (social media handles) */
const MENTION_RE = /@[a-zA-Z0-9_]{1,30}\b/g;

/** Matches full URLs — keeps only the domain */
const URL_RE = /https?:\/\/[^\s]+/g;

/**
 * Scrubs PII from text for safe transmission to AI services.
 * - Emails → [email]
 * - Phone numbers → [phone]
 * - @mentions → [user]
 * - Full URLs → domain only (e.g. "https://amazon.com/dp/B09V3..." → "amazon.com")
 */
export function scrubPII(text: string): string {
	return text
		.replace(URL_RE, (url) => {
			try {
				return new URL(url).hostname.replace(/^www\./, '');
			} catch {
				return '[link]';
			}
		})
		.replace(EMAIL_RE, '[email]')
		.replace(PHONE_RE, '[phone]')
		.replace(MENTION_RE, '[user]');
}
