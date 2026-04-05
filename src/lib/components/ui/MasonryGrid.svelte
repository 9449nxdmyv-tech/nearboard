<!--
  @file MasonryGrid.svelte
  @description Responsive CSS columns masonry layout wrapper.
               Eliminates repeated masonry class strings across routes.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		columns = 3,
		class: extraClass = '',
		children
	}: {
		columns?: 2 | 3;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class="relative z-0 gap-3 sm:gap-4 {columns === 2
	? 'columns-2'
	: 'columns-2 md:columns-3'} [&>div]:break-inside-avoid [&>div]:mb-3 [&>a]:break-inside-avoid [&>a]:mb-3 sm:[&>div]:mb-4 sm:[&>a]:mb-4 {extraClass}">
	{@render children()}
</div>
