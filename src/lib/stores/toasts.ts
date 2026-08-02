import { writable } from 'svelte/store';

/**
 * Short confirmations for actions that otherwise happen invisibly.
 *
 * Report, block and join all changed state and said nothing, which reads as a
 * button that did not work. For a safety action that is the worst place to
 * leave doubt — someone blocking a harasser needs to know it took effect.
 *
 * Undo is offered where the action is reversible and the cost of a misfire is
 * real. Blocking the wrong person by mis-tapping is easy and, without undo,
 * only fixable by digging through a settings screen.
 */

export interface Toast {
  id: number;
  message: string;
  /** Present only when the action can be taken back. */
  undo?: () => void;
  /** How long before it disappears. Undoable toasts linger. */
  durationMs: number;
}

export const toasts = writable<Toast[]>([]);

let nextId = 1;

const DEFAULT_MS = 2600;
const UNDOABLE_MS = 6000;

export function showToast(message: string, undo?: () => void): void {
  const id = nextId++;
  const durationMs = undo ? UNDOABLE_MS : DEFAULT_MS;

  toasts.update((current) => [...current, { id, message, undo, durationMs }]);

  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  toasts.update((current) => current.filter((t) => t.id !== id));
}

/** Run a toast's undo and clear it, so the confirmation cannot be tapped twice. */
export function runUndo(toast: Toast): void {
  toast.undo?.();
  dismissToast(toast.id);
}
