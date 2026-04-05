/**
 * @file dateFormatter.ts
 * @description Shared date formatting utilities used across card components and briefings.
 */

/** Cached Intl.RelativeTimeFormat instance (one per session, uses browser locale). */
let _rtf: Intl.RelativeTimeFormat | null = null;

function rtf(): Intl.RelativeTimeFormat {
	if (!_rtf) {
		try {
			_rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });
		} catch {
			// Fallback to English if browser locale is unsupported
			_rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
		}
	}
	return _rtf;
}

/**
 * Returns a locale-aware human-readable relative time string.
 * Uses `Intl.RelativeTimeFormat` with the user's browser locale so output
 * is automatically localized (e.g. "gestern" for German, "hier" for French).
 */
export function relativeTime(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	const fmt = rtf();

	if (diffSec < 30) return fmt.format(0, 'second'); // "now" / "maintenant" / "jetzt"
	if (diffMin < 60) return fmt.format(-diffMin, 'minute');
	if (diffHr < 24) return fmt.format(-diffHr, 'hour');
	if (diffDay < 7) return fmt.format(-diffDay, 'day');

	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Formats a Date as a short time string using the user's browser locale.
 */
export function shortTime(date: Date): string {
	return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Formats a duration in milliseconds as m:ss (e.g. 1:05, 0:30).
 */
export function formatDurationMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Formats a Date or Firestore Timestamp as "Month Year" (e.g. "March 2026").
 */
export function formatMonthYear(date: Date | { toDate: () => Date }): string {
	const d = date instanceof Date ? date : date.toDate();
	return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Formats a Date or Firestore Timestamp as "Mon Day" (e.g. "Mar 19").
 */
export function formatShortDate(date: Date | { toDate: () => Date }): string {
	const d = date instanceof Date ? date : date.toDate();
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
