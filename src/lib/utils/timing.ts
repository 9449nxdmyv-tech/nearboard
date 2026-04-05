/**
 * @file timing.ts
 * @description Utilities for debouncing and throttling function calls.
 */

/**
 * Creates a debounced function that delays execution until after `wait` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 */
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout> | null = null;

	return function (...args: Parameters<T>) {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => {
			func(...args);
		}, wait);
	};
}

/**
 * Creates a throttled function that only invokes `func` at most once per
 * every `wait` milliseconds.
 */
export function throttle<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let lastCall = 0;
	return function (...args: Parameters<T>) {
		const now = Date.now();
		if (now - lastCall >= wait) {
			lastCall = now;
			func(...args);
		}
	};
}
