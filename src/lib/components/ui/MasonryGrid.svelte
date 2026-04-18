<!--
  @file MasonryGrid.svelte
  @description Responsive layout wrapper supporting single-column, masonry, and compact-grid modes.
               Eliminates repeated layout class strings across routes.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutStyle } from '$lib/types/firestore';

	let {
		columns = 3,
		layout = 'masonry' as LayoutStyle,
		class: extraClass = '',
		children
	}: {
		columns?: 2 | 3;
		layout?: LayoutStyle;
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#if layout === 'single-column'}
	<div class="relative z-0 max-w-lg mx-auto flex flex-col gap-3 sm:gap-4 {extraClass}">
		{@render children()}
	</div>
{:else if layout === 'compact-grid'}
	<div class="relative z-0 grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 [&>div]:overflow-hidden {extraClass}">
		{@render children()}
	</div>
{:else}
	<div class="relative z-0 gap-3 sm:gap-4 {columns === 2
		? 'columns-2'
		: 'columns-2 md:columns-3'} [&>div]:break-inside-avoid [&>div]:mb-3 [&>a]:break-inside-avoid [&>a]:mb-3 sm:[&>div]:mb-4 sm:[&>a]:mb-4 {extraClass}">
		{@render children()}
	</div>
{/if}
