<!--
  @file QuickCaptureShell.svelte
  @description Shared wrapper for fullscreen QuickCapture*Sheet components.
               Centralizes Escape-key handling, body scroll lock, backdrop,
               fade transition, and fly-in animation for the content container.
               Each sheet supplies its own body via the default snippet and
               can tune container shape via `containerClass` / `backdropClass`.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { useScrollLock } from '$lib/utils/scrollLock.svelte';
	import { swipeToDismiss } from '$lib/utils/swipeToDismiss';
	import type { Snippet } from 'svelte';

	type Props = {
		/** Called when the user dismisses the sheet (Escape key or backdrop click). */
		onClose: () => void;
		/**
		 * If true (default), clicking the backdrop calls onClose.
		 * Set to false for media-capture sheets where an accidental tap
		 * mid-recording would discard the user's work.
		 */
		closeOnBackdrop?: boolean;
		/** Extra classes appended to the content container (size, rounding, ring). */
		containerClass?: string;
		/** Backdrop background class override. */
		backdropClass?: string;
		children: Snippet;
	};

	let {
		onClose,
		closeOnBackdrop = true,
		containerClass = 'sm:max-w-xl sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl',
		backdropClass = 'bg-black/40 sm:bg-black/60 sm:backdrop-blur-md',
		children
	}: Props = $props();

	useScrollLock();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	transition:fade={{ duration: 200 }}
>
	<div
		class="fixed inset-0 {backdropClass}"
		aria-hidden="true"
		onclick={closeOnBackdrop ? onClose : undefined}
	></div>

	<div
		class="relative z-10 w-full h-full sm:h-auto bg-surface flex flex-col overflow-hidden {containerClass}"
		in:fly={{ y: 40, duration: 300, easing: quintOut }}
		onclick={(e) => e.stopPropagation()}
		use:swipeToDismiss={{ onDismiss: onClose, disabled: !closeOnBackdrop }}
	>
		{@render children()}
	</div>
</div>
