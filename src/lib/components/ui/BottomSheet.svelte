<!--
  @file BottomSheet.svelte
  @description Simple bottom sheet using Konsta UI Sheet + Navbar + Button.
-->
<script lang="ts">
	import { Sheet, Navbar, NavbarBackLink } from 'konsta/svelte';

	let {
		open,
		title,
		subtitle,
		children,
		onClose,
		closeOnBackdrop = true
	}: {
		open: boolean;
		title: string;
		subtitle?: string;
		children: import('svelte').Snippet;
		onClose: () => void;
		closeOnBackdrop?: boolean;
	} = $props();

	function handleBackdropClick() {
		if (closeOnBackdrop) onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#snippet navLeft()}
	<NavbarBackLink onClick={onClose} text="Close" />
{/snippet}

<Sheet
	opened={open}
	backdrop={true}
	onBackdropClick={handleBackdropClick}
	class="!max-w-lg !mx-auto"
>
	{#if title}
		<Navbar title={title} subtitle={subtitle} left={navLeft} />
	{:else}
		<div class="flex justify-center pt-2.5 pb-1">
			<div class="w-9 h-1 rounded-full bg-surface-2"></div>
		</div>
	{/if}

	<div class="overflow-y-auto flex-1 pb-safe">
		{@render children()}
	</div>
</Sheet>
