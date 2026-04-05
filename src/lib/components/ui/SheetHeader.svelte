<!--
  @file SheetHeader.svelte
  @description Reusable header for bottom sheets, including drag handle, title, and close button.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let {
		title,
		subtitle,
		onClose
	}: {
		title?: string;
		subtitle?: string;
		onClose: () => void;
	} = $props();
</script>

<div class="flex flex-col items-center pt-2.5 pb-1">
	<div class="w-9 h-1 rounded-full bg-border"></div>
</div>

<div class="flex items-center justify-between px-4 pb-3">
	<div class="flex-1">
		{#if title}
			<h2 class="text-xl font-semibold text-on-surface">{title}</h2>
		{/if}
		{#if subtitle}
			<p class="text-sm text-muted">{subtitle}</p>
		{/if}
	</div>
	<button onclick={onClose} class="p-2 -mr-2 text-on-surface-secondary press-scale" aria-label="Close">
		<Icon icon="ph:x-bold" class="text-xl" />
	</button>
</div>
