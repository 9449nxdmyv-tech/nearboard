/**
 * @file haptics.ts
 * @description Cross-platform haptic feedback utility. Uses Capacitor Haptics
 *              on native, falls back to navigator.vibrate on Android web, no-op elsewhere.
 */

import { Capacitor } from '@capacitor/core';

let HapticsPlugin: typeof import('@capacitor/haptics').Haptics | null = null;
let ImpactStyle: typeof import('@capacitor/haptics').ImpactStyle | undefined;
let NotificationType: typeof import('@capacitor/haptics').NotificationType | undefined;

// Lazy-load Capacitor Haptics only on native platforms
if (Capacitor.isNativePlatform()) {
	import('@capacitor/haptics').then((mod) => {
		HapticsPlugin = mod.Haptics;
		ImpactStyle = mod.ImpactStyle;
		NotificationType = mod.NotificationType;
	}).catch(() => {});
}

/** Light tap — use for button presses, toggles, selections */
export function hapticLight(): void {
	if (HapticsPlugin && ImpactStyle) {
		HapticsPlugin.impact({ style: ImpactStyle.Light }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate(10);
	}
}

/** Medium tap — use for confirmations, swipe thresholds, FAB press */
export function hapticMedium(): void {
	if (HapticsPlugin && ImpactStyle) {
		HapticsPlugin.impact({ style: ImpactStyle.Medium }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate(20);
	}
}

/** Heavy tap — use for destructive actions, long-press confirms */
export function hapticHeavy(): void {
	if (HapticsPlugin && ImpactStyle) {
		HapticsPlugin.impact({ style: ImpactStyle.Heavy }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate(30);
	}
}

/** Success notification — use after completing an action successfully */
export function hapticSuccess(): void {
	if (HapticsPlugin && NotificationType) {
		HapticsPlugin.notification({ type: NotificationType.Success }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate([10, 50, 10]);
	}
}

/** Warning notification — use for approaching limits, threshold reached */
export function hapticWarning(): void {
	if (HapticsPlugin && NotificationType) {
		HapticsPlugin.notification({ type: NotificationType.Warning }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate([20, 40, 20]);
	}
}

/** Error notification — use for failed actions, destructive confirms */
export function hapticError(): void {
	if (HapticsPlugin && NotificationType) {
		HapticsPlugin.notification({ type: NotificationType.Error }).catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate([30, 30, 30]);
	}
}

/** Selection tick — ultra-light, use for picker scrolls, minor selections */
export function hapticSelection(): void {
	if (HapticsPlugin) {
		HapticsPlugin.selectionStart().catch(() => {});
	}
}

/** Selection changed — use for picker value changes */
export function hapticSelectionChanged(): void {
	if (HapticsPlugin) {
		HapticsPlugin.selectionChanged().catch(() => {});
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate(8);
	}
}

/** Selection end — use when picker interaction ends */
export function hapticSelectionEnd(): void {
	if (HapticsPlugin) {
		HapticsPlugin.selectionEnd().catch(() => {});
	}
}

/** Soft tap — minimal feedback for subtle interactions */
export function hapticSoft(): void {
	if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate(5);
	}
}

/** Double tap — use for like/favorite actions */
export function hapticDoubleTap(): void {
	if (HapticsPlugin && ImpactStyle) {
		HapticsPlugin.impact({ style: ImpactStyle.Light }).catch(() => {});
		setTimeout(() => HapticsPlugin?.impact({ style: ImpactStyle!.Light }).catch(() => {}), 100);
	} else if (typeof navigator !== 'undefined' && navigator.vibrate) {
		navigator.vibrate([15, 30, 15]);
	}
}
