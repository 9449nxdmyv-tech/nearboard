/**
 * @file requestDeduplication.ts
 * @description Prevents duplicate concurrent requests for the same URL.
 *              Uses a promise map to share in-flight requests.
 */

interface PendingRequest<T> {
	promise: Promise<T>;
	timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();

const CLEANUP_INTERVAL = 60_000; // Clean up every minute
let cleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Start the cleanup interval for stale pending requests.
 */
function startCleanupInterval(): void {
	if (cleanupIntervalId) return;
	
	cleanupIntervalId = setInterval(() => {
		const now = Date.now();
		const maxAge = 30_000; // Consider requests stale after 30 seconds
		
		for (const [key, value] of pendingRequests.entries()) {
			if (now - value.timestamp > maxAge) {
				pendingRequests.delete(key);
			}
		}
	}, CLEANUP_INTERVAL);
	
	cleanupIntervalId.unref(); // Don't prevent process exit
}

/**
 * Execute a function with request deduplication.
 * If another request for the same key is in-flight, returns that promise instead.
 * 
 * @param key - Unique identifier for the request (e.g., URL)
 * @param fn - Function to execute if no duplicate is in-flight
 * @returns Promise resolving to the function result
 */
export async function withDeduplication<T>(
	key: string,
	fn: () => Promise<T>
): Promise<T> {
	startCleanupInterval();
	
	const existing = pendingRequests.get(key) as PendingRequest<T> | undefined;
	if (existing) {
		console.log(`Deduplicating request for: ${key}`);
		return existing.promise;
	}
	
	const promise = (async () => {
		try {
			return await fn();
		} finally {
			pendingRequests.delete(key);
		}
	})();
	
	pendingRequests.set(key, {
		promise,
		timestamp: Date.now(),
	});
	
	return promise;
}

/**
 * Clear all pending requests (useful for testing or shutdown).
 */
export function clearPendingRequests(): void {
	pendingRequests.clear();
	if (cleanupIntervalId) {
		clearInterval(cleanupIntervalId);
		cleanupIntervalId = null;
	}
}

/**
 * Get the number of pending requests (useful for monitoring).
 */
export function getPendingRequestCount(): number {
	return pendingRequests.size;
}
