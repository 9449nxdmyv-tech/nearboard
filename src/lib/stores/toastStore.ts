/**
 * @file toastStore.ts
 * @description Enhanced toast notification store with better animations,
 *              positioning options, and promise support.
 *              Compatible with svelte-sonner patterns.
 */

import { writable } from 'svelte/store';
import { hapticSuccess, hapticError, hapticWarning } from '$lib/utils/haptics';

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';
export type ToastPosition = 'top-center' | 'top-right' | 'bottom-center' | 'bottom-right';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	description?: string;
	action?: ToastAction;
	duration?: number;
	dismissible?: boolean;
	position?: ToastPosition;
	icon?: string;
}

export interface ToastAction {
	label: string;
	onClick: () => void;
	callback?: () => void; // Backwards compatibility
}

export interface ToastOptions {
	duration?: number;
	dismissible?: boolean;
	position?: ToastPosition;
	action?: ToastAction;
	icon?: string;
	description?: string;
}

export const toastStore = writable<Toast[]>([]);

// Per-toast dismiss timers, so updateToast can cancel a stale schedule before
// queueing a new one (otherwise repeated updates stack timers and the toast
// can vanish earlier than the latest duration).
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDismiss(id: string, durationMs: number): void {
	const existing = dismissTimers.get(id);
	if (existing) clearTimeout(existing);
	dismissTimers.set(id, setTimeout(() => {
		dismissTimers.delete(id);
		dismissToast(id);
	}, durationMs));
}

const DURATION_MS: Record<ToastType, number> = {
	success: 3000,
	error: 5000,
	info: 4000,
	warning: 4000,
	loading: 0 // Doesn't auto-dismiss
};

const DEFAULT_POSITION: ToastPosition = 'top-center';

function createToast(
	message: string,
	type: ToastType,
	options: ToastOptions = {}
): string {
	const id = crypto.randomUUID();
	const toast: Toast = {
		id,
		type,
		message,
		description: options.description,
		action: options.action,
		duration: options.duration ?? DURATION_MS[type],
		dismissible: options.dismissible ?? true,
		position: options.position ?? DEFAULT_POSITION,
		icon: options.icon
	};

	toastStore.update((toasts) => {
		// Cap at 5 visible toasts — drop oldest if over limit
		const updated = [...toasts, toast];
		return updated.length > 5 ? updated.slice(-5) : updated;
	});

	// Haptic feedback
	if (type === 'success') hapticSuccess();
	else if (type === 'error') hapticError();
	else if (type === 'warning') hapticWarning();

	// Auto-dismiss
	if (toast.duration && toast.duration > 0) {
		scheduleDismiss(id, toast.duration);
	}

	return id;
}

export function dismissToast(id: string): void {
	const existing = dismissTimers.get(id);
	if (existing) {
		clearTimeout(existing);
		dismissTimers.delete(id);
	}
	toastStore.update((toasts) => toasts.filter((t) => t.id !== id));
}

export function updateToast(id: string, updates: Partial<Toast>): void {
	toastStore.update((toasts) =>
		toasts.map((t) => (t.id === id ? { ...t, ...updates } : t))
	);

	if (updates.duration && updates.duration > 0) {
		scheduleDismiss(id, updates.duration);
	}
}

// Convenience methods
export const toast = {
	success: (message: string, options?: ToastOptions) =>
		createToast(message, 'success', options),

	error: (message: string, options?: ToastOptions) =>
		createToast(message, 'error', options),

	info: (message: string, options?: ToastOptions) =>
		createToast(message, 'info', options),

	warning: (message: string, options?: ToastOptions) =>
		createToast(message, 'warning', options),

	loading: (message: string, options?: ToastOptions) =>
		createToast(message, 'loading', { ...options, dismissible: false }),

	// Promise-based toast
	promise: async <T>(
		promise: Promise<T>,
		messages: {
			loading: string;
			success: string;
			error: string;
		},
		options?: ToastOptions
	): Promise<T> => {
		const id = toast.loading(messages.loading, options);

		try {
			const result = await promise;
			updateToast(id, {
				type: 'success',
				message: messages.success,
				duration: DURATION_MS.success
			});
			hapticSuccess();
			return result;
		} catch (err) {
			updateToast(id, {
				type: 'error',
				message: messages.error,
				duration: DURATION_MS.error
			});
			hapticError();
			throw err;
		}
	}
};

// Backwards compatibility
export function showToast(
	message: string,
	type: ToastType = 'error',
	options?: ToastOptions
): void {
	createToast(message, type, options);
}
