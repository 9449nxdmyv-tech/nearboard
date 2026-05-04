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
	<!--
	  Uniform square tiles. Each direct child is forced to aspect-square with
	  overflow-hidden so every card renders as a consistent thumbnail; the
	  inner article keeps its own styling but is clipped from the bottom.

	  Photo cards (marked with [data-card-type="photo"]) get full-bleed
	  treatment: the image fills the entire square and the body+footer
	  (caption, author, interactions) are hidden for a true gallery look.
	-->
	<div
		class="relative z-0 grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3
			[&>div]:aspect-square [&>div]:overflow-hidden [&>div]:rounded-[var(--radius-card)]
			[&>div_div:has(article)]:h-full
			[&>div_article]:h-full [&>div_article]:shadow-none [&>div_article]:rounded-none
			[&>div_article:has([data-card-type=photo])]:relative
			[&>div_article:has([data-card-type=photo])>*]:hidden
			[&>div_article_[data-card-type=photo]]:!block
			[&>div_article_[data-card-type=photo]]:absolute
			[&>div_article_[data-card-type=photo]]:inset-0
			[&>div_article_[data-card-type=photo]_img]:!h-full
			[&>div_article_[data-card-type=photo]_img]:!w-full
			[&>div_article_[data-card-type=photo]_img]:!object-cover
			{extraClass}"
	>
		{@render children()}
	</div>
{:else}
	<div class="relative z-0 gap-3 sm:gap-4 {columns === 2
		? 'columns-2'
		: 'columns-2 md:columns-3'} [&>div]:break-inside-avoid [&>div]:mb-3 [&>a]:break-inside-avoid [&>a]:mb-3 sm:[&>div]:mb-4 sm:[&>a]:mb-4 {extraClass}">
		{@render children()}
	</div>
{/if}
