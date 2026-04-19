/**
 * @file swipeToDismiss.ts
 * @description Svelte action — adds pull-down-to-dismiss gesture to bottom sheets and
 *              full-screen modals. The sheet follows the finger during drag, then
 *              either snaps back or slides off-screen and calls `onDismiss`.
 *              Ignores drags that start on scrolled-down scrollable children so
 *              internal scrolling keeps working.
 */
import type { Action } from 'svelte/action';
import { hapticLight } from './haptics';

export interface SwipeToDismissOptions {
	/** Called when the swipe crosses the dismiss threshold. */
	onDismiss: () => void;
	/** Pixel distance the user must drag before dismissal. Default 96. */
	threshold?: number;
	/** Fling velocity (px/s) that dismisses regardless of distance. Default 600. */
	velocityThreshold?: number;
	/** Resistance factor applied past `threshold` (1 = free, >1 = drag feels heavier). Default 1. */
	rubberBand?: number;
	/** When true, the action is a no-op. Mirrors `closeOnBackdrop={false}` semantics. */
	disabled?: boolean;
}

const MOVE_ACTIVATION_PX = 6;

/**
 * Walks up from `target` to `root`, returning true if any ancestor is a scrolled
 * scrollable container. This lets us suppress the swipe when the user is trying
 * to scroll sheet content rather than dismiss the sheet.
 */
function isInsideScrolledChild(target: EventTarget | null, root: HTMLElement): boolean {
	if (!(target instanceof Element)) return false;
	let el: Element | null = target;
	while (el && el !== root) {
		if (el instanceof HTMLElement) {
			const overflowY = getComputedStyle(el).overflowY;
			if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollTop > 0) {
				return true;
			}
		}
		el = el.parentElement;
	}
	return false;
}

export const swipeToDismiss: Action<HTMLElement, SwipeToDismissOptions> = (node, initial) => {
	let opts: SwipeToDismissOptions = initial;
	let activePointerId: number | null = null;
	let startY = 0;
	let startTime = 0;
	let dragging = false;
	let currentDy = 0;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	// Only apply touchAction suppression when a drag starts — keeping the element
	// default otherwise means inner scroll areas and nav controls stay responsive.
	const originalTouchAction = node.style.touchAction;

	function clearStyles() {
		node.style.transition = '';
		node.style.transform = '';
		node.style.touchAction = originalTouchAction;
	}

	function onPointerDown(e: PointerEvent) {
		if (opts.disabled) return;
		// Mouse users get backdrop / Escape; swipe is a touch idiom.
		if (e.pointerType === 'mouse') return;
		if (activePointerId !== null) return;
		if (isInsideScrolledChild(e.target, node)) return;
		activePointerId = e.pointerId;
		startY = e.clientY;
		startTime = performance.now();
		dragging = false;
		currentDy = 0;
	}

	function onPointerMove(e: PointerEvent) {
		if (activePointerId !== e.pointerId) return;
		const dy = e.clientY - startY;

		if (!dragging) {
			if (dy > MOVE_ACTIVATION_PX) {
				dragging = true;
				try { node.setPointerCapture(e.pointerId); } catch { /* capture may fail on some browsers */ }
				node.style.transition = 'none';
				node.style.touchAction = 'none';
			} else {
				return;
			}
		}

		if (dy <= 0) {
			currentDy = 0;
			node.style.transform = '';
			return;
		}

		const resistance = opts.rubberBand ?? 1;
		currentDy = resistance === 1 ? dy : dy / resistance;
		node.style.transform = `translateY(${currentDy}px)`;
	}

	function onPointerUp(e: PointerEvent) {
		if (activePointerId !== e.pointerId) return;
		activePointerId = null;
		if (!dragging) return;
		dragging = false;

		const elapsed = performance.now() - startTime;
		const velocity = elapsed > 0 ? (currentDy * 1000) / elapsed : 0;
		const threshold = opts.threshold ?? 96;
		const velocityThreshold = opts.velocityThreshold ?? 600;

		if (currentDy > threshold || velocity > velocityThreshold) {
			const travel = Math.max(node.offsetHeight, currentDy + 120);
			node.style.transition = 'transform 180ms cubic-bezier(0.4, 0, 0.2, 1)';
			node.style.transform = `translateY(${travel}px)`;
			hapticLight();
			opts.onDismiss();
			// Leave the transform in place briefly — the parent unmount animation
			// will take over on the next tick.
			clearTimeout(resetTimer);
			resetTimer = setTimeout(clearStyles, 220);
		} else {
			node.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
			node.style.transform = '';
			clearTimeout(resetTimer);
			resetTimer = setTimeout(clearStyles, 260);
		}
	}

	node.addEventListener('pointerdown', onPointerDown, { passive: true });
	node.addEventListener('pointermove', onPointerMove, { passive: true });
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerUp);

	return {
		update(next: SwipeToDismissOptions) {
			opts = next;
			if (opts.disabled && dragging) {
				activePointerId = null;
				dragging = false;
				clearStyles();
			}
		},
		destroy() {
			clearTimeout(resetTimer);
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerUp);
			clearStyles();
		}
	};
};
