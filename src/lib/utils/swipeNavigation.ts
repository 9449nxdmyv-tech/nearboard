/**
 * @file swipeNavigation.ts
 * @description Edge swipe gesture for native-style back navigation.
 *              Detects swipe from left edge and triggers browser back.
 */

import { hapticLight, hapticMedium } from './haptics';

interface SwipeNavigationOptions {
	threshold?: number;
	onSwipeBack?: () => void;
	enabled?: boolean;
}

export function initSwipeNavigation(options: SwipeNavigationOptions = {}) {
	const {
		threshold = 100,
		onSwipeBack,
		enabled = true
	} = options;

	if (!enabled || typeof window === 'undefined') return () => {};

	let startX = 0;
	let isSwiping = false;
	let swipeThresholdReached = false;

	function handleTouchStart(e: TouchEvent) {
		// Only trigger from left edge (within 30px)
		const touch = e.touches[0];
		if (touch.clientX > 30) return;

		// Don't interfere with interactive elements
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, button, [data-no-swipe]')) return;

		isSwiping = true;
		startX = touch.clientX;
		swipeThresholdReached = false;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isSwiping) return;

		const touch = e.touches[0];
		const deltaX = touch.clientX - startX;

		// Only horizontal swipe
		if (deltaX <= 0) return;

		// Visual feedback could be added here (edge glow effect)
		if (deltaX > threshold && !swipeThresholdReached) {
			swipeThresholdReached = true;
			hapticMedium();
		} else if (deltaX < threshold && swipeThresholdReached) {
			swipeThresholdReached = false;
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!isSwiping) return;
		isSwiping = false;

		const touch = e.changedTouches[0];
		const deltaX = touch.clientX - startX;

		if (deltaX > threshold && swipeThresholdReached) {
			hapticLight();
			if (onSwipeBack) {
				onSwipeBack();
			} else {
				// Default: browser back
				history.back();
			}
		}
	}

	function handleTouchCancel() {
		isSwiping = false;
		swipeThresholdReached = false;
	}

	// Add listeners
	document.addEventListener('touchstart', handleTouchStart, { passive: true });
	document.addEventListener('touchmove', handleTouchMove, { passive: true });
	document.addEventListener('touchend', handleTouchEnd, { passive: true });
	document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

	// Cleanup
	return () => {
		document.removeEventListener('touchstart', handleTouchStart);
		document.removeEventListener('touchmove', handleTouchMove);
		document.removeEventListener('touchend', handleTouchEnd);
		document.removeEventListener('touchcancel', handleTouchCancel);
	};
}

/**
 * Svelte action for swipe navigation on specific elements
 * Usage: <div use:swipeBack={{ onSwipe: () => goto('/home') }}>
 */
export function swipeBack(
	node: HTMLElement,
	options: { onSwipe?: () => void; threshold?: number } = {}
) {
	const { threshold = 100, onSwipe } = options;

	let startX = 0;
	let isSwiping = false;
	let swipeThresholdReached = false;

	function handleTouchStart(e: TouchEvent) {
		const touch = e.touches[0];
		startX = touch.clientX;
		isSwiping = true;
		swipeThresholdReached = false;
		hapticLight();
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isSwiping) return;
		const touch = e.touches[0];
		const deltaX = touch.clientX - startX;

		if (deltaX > threshold && !swipeThresholdReached) {
			swipeThresholdReached = true;
			hapticMedium();
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!isSwiping) return;
		isSwiping = false;

		const touch = e.changedTouches[0];
		const deltaX = touch.clientX - startX;

		if (deltaX > threshold && swipeThresholdReached) {
			if (onSwipe) {
				onSwipe();
			} else {
				history.back();
			}
		}
	}

	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchmove', handleTouchMove, { passive: true });
	node.addEventListener('touchend', handleTouchEnd, { passive: true });

	return {
		destroy() {
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchmove', handleTouchMove);
			node.removeEventListener('touchend', handleTouchEnd);
		}
	};
}
