/**
 * @file scrollLock.svelte.ts
 * @description Reusable body scroll lock for fullscreen overlays.
 *              Prevents background scrolling and restores scroll position on cleanup.
 *              Must be called at the top level of a component's <script> block.
 */

/**
 * Locks body scroll for the lifetime of the calling component.
 * Use in components that are always mounted when visible (e.g., QuickCapture sheets).
 */
export function useScrollLock(): void {
	$effect(() => {
		const scrollY = window.scrollY;
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
		return () => {
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.width = '';
			window.scrollTo(0, scrollY);
		};
	});
}

/**
 * Conditionally locks body scroll based on a reactive getter.
 * Use for components that toggle visibility (e.g., ImageZoom with open prop).
 */
export function useConditionalScrollLock(isActive: () => boolean): void {
	$effect(() => {
		if (!isActive()) return;
		const scrollY = window.scrollY;
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
		return () => {
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.width = '';
			window.scrollTo(0, scrollY);
		};
	});
}
