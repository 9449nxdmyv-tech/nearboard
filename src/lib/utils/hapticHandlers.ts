/**
 * @file hapticHandlers.ts
 * @description Reusable haptic feedback handlers for consistent UX across components.
 *              Wraps callbacks with haptic feedback to reduce code duplication.
 */

import { hapticLight, hapticSuccess, hapticError } from './haptics';

/**
 * Creates a click handler that triggers light haptic feedback before executing the callback.
 * Use for general interactions like button clicks, toggles, etc.
 */
export function withHaptic<T extends (...args: any[]) => any>(
	fn: T,
	...args: Parameters<T>
): () => ReturnType<T> {
	return () => {
		hapticLight();
		return fn(...args);
	};
}

/**
 * Creates a click handler that triggers success haptic feedback after executing the callback.
 * Use for successful actions like form submissions, saves, etc.
 */
export function withSuccessHaptic<T extends (...args: any[]) => any>(
	fn: T,
	...args: Parameters<T>
): () => ReturnType<T> {
	return () => {
		const result = fn(...args);
		hapticSuccess();
		return result;
	};
}

/**
 * Creates a click handler that triggers error haptic feedback after executing the callback.
 * Use for failed actions or validation errors.
 */
export function withErrorHaptic<T extends (...args: any[]) => any>(
	fn: T,
	...args: Parameters<T>
): () => ReturnType<T> {
	return () => {
		const result = fn(...args);
		hapticError();
		return result;
	};
}

/**
 * Creates a toggle handler with haptic feedback.
 * Returns a new toggle function that triggers haptic on each call.
 */
export function createHapticToggle(
	setter: (value: boolean) => void,
	currentValue: boolean
): () => void {
	return () => {
		hapticLight();
		setter(!currentValue);
	};
}

/**
 * Creates a counter adjuster with haptic feedback.
 * Returns a function that adjusts a value by delta with haptic feedback.
 */
export function createHapticAdjuster(
	setter: (value: number) => void,
	currentValue: number,
	min: number,
	max: number
): (delta: number) => void {
	return (delta: number) => {
		hapticLight();
		const newValue = Math.max(min, Math.min(max, currentValue + delta));
		setter(newValue);
	};
}
