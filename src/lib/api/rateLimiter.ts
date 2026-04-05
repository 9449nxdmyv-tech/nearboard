/**
 * @file rateLimiter.ts
 * @description Shared in-memory rate limiter for server-side API routes.
 *              Per-IP, sliding-window counter with automatic stale entry cleanup.
 */

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

interface RateLimiterOptions {
	/** Maximum requests per window (default: 30) */
	max?: number;
	/** Window duration in milliseconds (default: 60_000) */
	windowMs?: number;
}

/**
 * Creates a per-IP rate limiter backed by an in-memory Map.
 * Expired entries are lazily cleaned up on each check call.
 */
export function createRateLimiter({ max = 30, windowMs = 60_000 }: RateLimiterOptions = {}) {
	const store = new Map<string, RateLimitEntry>();
	let lastCleanup = Date.now();
	const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

	/**
	 * Removes entries whose window has expired.
	 * Runs at most once per CLEANUP_INTERVAL_MS to avoid overhead.
	 */
	function maybeCleanup(now: number): void {
		if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
		lastCleanup = now;
		for (const [ip, entry] of store) {
			if (entry.resetAt < now) store.delete(ip);
		}
	}

	/**
	 * Returns true if the IP has exceeded its rate limit for the current window.
	 */
	function isRateLimited(ip: string): boolean {
		const now = Date.now();
		maybeCleanup(now);

		const entry = store.get(ip);
		if (!entry || entry.resetAt < now) {
			store.set(ip, { count: 1, resetAt: now + windowMs });
			return false;
		}
		entry.count++;
		return entry.count > max;
	}

	return { isRateLimited };
}
