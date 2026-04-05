/**
 * @file longPress.ts
 * @description Adaptive card interaction handler for touch and mouse.
 *              - Touch: quick tap fires `onTap`, long press fires `onLongPress`
 *              - Mouse: click fires `onClick` (no long-press — unnatural on desktop)
 *              Branching is per-event via `pointerType`, not a global media query,
 *              so hybrid devices (touch-screen laptops) get the right behavior
 *              depending on which input the user is actually using.
 */

import { hapticMedium } from './haptics';

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
	onpointerdown: (e: PointerEvent) => void;
	onpointermove: (e: PointerEvent) => void;
	onpointerup: (e: PointerEvent) => void;
	onpointercancel: () => void;
}

/**
 * Creates unified pointer handlers with different behavior per input type:
 *
 * **Touch** (`pointerType === 'touch'`):
 *   - Quick tap → `onTap`
 *   - Hold 400ms → `onLongPress` (with haptic)
 *
 * **Mouse / pen** (desktop):
 *   - Click → `onClick`
 *   - Long press is ignored
 */
export function createLongPressHandlers(opts: {
	/** Touch: fires on quick tap. */
	onTap: (e: PointerEvent) => void;
	/** Touch: fires after holding 400ms. */
	onLongPress: () => void;
	/** Mouse: fires on click. */
	onClick: (e: PointerEvent) => void;
}): LongPressHandlers {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let startX = 0;
	let startY = 0;
	let fired = false;
	let isTouch = false;
	let pressTarget: HTMLElement | null = null;

	function clear() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (pressTarget) {
			pressTarget.style.transform = '';
			pressTarget.style.transition = '';
			pressTarget = null;
		}
	}

	return {
		onpointerdown(e: PointerEvent) {
			if (e.button !== 0) return;
			isTouch = e.pointerType === 'touch';
			fired = false;

			if (!isTouch) return; // Mouse clicks handled in onpointerup

			startX = e.clientX;
			startY = e.clientY;
			if (timer) { clearTimeout(timer); timer = null; }

			// Visual feedback: subtle scale during hold
			pressTarget = e.currentTarget as HTMLElement;
			pressTarget.style.transition = 'transform 400ms cubic-bezier(0.25, 0.1, 0.25, 1)';
			pressTarget.style.transform = 'scale(0.97)';

			timer = setTimeout(() => {
				fired = true;
				hapticMedium();
				opts.onLongPress();
			}, LONG_PRESS_MS);
		},

		onpointermove(e: PointerEvent) {
			if (!timer) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
				clear();
			}
		},

		onpointerup(e: PointerEvent) {
			if (isTouch) {
				clear();
				if (!fired) {
					opts.onTap(e);
				}
			} else {
				// Mouse / pen — simple click
				opts.onClick(e);
			}
		},

		onpointercancel() {
			clear();
			fired = false;
		}
	};
}
