/**
 * @file animations.ts
 * @description Single source of truth for all animation constants.
 *              Import from here — never hardcode durations or easings inline.
 */

import { cubicOut, backOut } from 'svelte/easing';

/** Card entrance — new card slides up from below */
export const CARD_ENTRANCE = { y: 24, duration: 280, easing: cubicOut } as const;

/** FAB radial menu item animation */
export const FAB_ITEM = { duration: 200, easing: backOut } as const;

/** Stagger delay between FAB radial menu items (ms) */
export const FAB_STAGGER_DELAY = 30;

/** Fast micro-interactions (dismiss, toggle, etc.) */
export const TRANSITION_FAST = 150;

/** Spring config for poll result bars */
export const POLL_BAR_SPRING = { stiffness: 0.1, damping: 0.6 } as const;

/** Incoming card from another user — spring slide-in */
export const REMOTE_CARD_ENTRANCE = { y: 16, duration: 320, easing: cubicOut } as const;

/** Page-level transitions */
export const PAGE_TRANSITION = { duration: 200, easing: cubicOut } as const;

/** Card detail modal open/close */
export const MODAL_TRANSITION = { duration: 250, easing: cubicOut } as const;
