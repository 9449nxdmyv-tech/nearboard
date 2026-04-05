/**
 * @file timezone.ts
 * @description Shared timezone utilities for Cloud Functions.
 *              Used by morningDigest, smartReminders, and fcmService.
 */

/**
 * Returns the current hour (0-23) in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
export function getCurrentHourInTimezone(timezone: string): number {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hour: 'numeric',
			hour12: false
		});
		return parseInt(formatter.format(new Date()), 10);
	} catch {
		return new Date().getUTCHours();
	}
}

/**
 * Returns the current minute (0-59) in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
export function getCurrentMinuteInTimezone(timezone: string): number {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			minute: 'numeric'
		});
		return parseInt(formatter.format(new Date()), 10);
	} catch {
		return new Date().getUTCMinutes();
	}
}

/**
 * Checks if the local time in the given timezone is approximately at the
 * target hour (±30 min). e.g. targetHour=8 checks 7:30–8:30.
 */
export function isAroundHour(timezone: string, targetHour: number): boolean {
	const hour = getCurrentHourInTimezone(timezone);
	const minute = getCurrentMinuteInTimezone(timezone);
	const totalMinutes = hour * 60 + minute;
	const targetStart = (targetHour - 1) * 60 + 30; // e.g. 7:30 for target 8
	const targetEnd = targetHour * 60 + 30;          // e.g. 8:30 for target 8
	return totalMinutes >= targetStart && totalMinutes <= targetEnd;
}
