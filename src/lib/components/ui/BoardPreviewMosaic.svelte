<!--
  @file BoardPreviewMosaic.svelte
  @description Pinterest-style mini mosaic preview of a board's recent content.
               Ensures 100% tile coverage with no letterboxing.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { subscribeToBoardPreview } from '$lib/firebase';
	import type { ContentDoc } from '$lib/types';

	let { boardId, height = '100%' }: { boardId: string; height?: string } = $props();

	let items = $state<ContentDoc[]>([]);
	let loaded = $state(false);

	onMount(() => {
		const unsub = subscribeToBoardPreview(boardId, (content) => {
			items = content;
			loaded = true;
		}, () => { loaded = true; });
		return unsub;
	});

	/** Extract a thumbnail URL from a content item, if it has one. */
	function getThumbnail(item: ContentDoc): string | null {
		switch (item.type) {
			case 'photo':
				return item.imageUrl;
			case 'video':
				return item.thumbnailUrl;
			case 'link':
			case 'product':
				return item.image;
			default:
				return null;
		}
	}

	/** Get an icon + color pair for non-visual content types. */
	function getTileStyle(item: ContentDoc): { icon: string; bg: string; fg: string } {
		switch (item.type) {
			case 'note':
				return { icon: 'ph:note', bg: 'bg-primary/10', fg: 'text-on-surface' };
			case 'list':
				return { icon: 'ph:list-checks', bg: 'bg-primary/10', fg: 'text-on-surface' };
			case 'voice':
				return { icon: 'ph:waveform', bg: 'bg-primary/10', fg: 'text-on-surface' };
			case 'poll':
				return { icon: 'ph:chart-bar', bg: 'bg-primary/10', fg: 'text-on-surface' };
			case 'location':
				return { icon: 'ph:map-pin', bg: 'bg-primary/10', fg: 'text-on-surface' };
			default:
				return { icon: 'ph:squares-four', bg: 'bg-surface-1', fg: 'text-on-surface' };
		}
	}

	/** Split items into columns for masonry effect. */
	const columns = $derived.by(() => {
		const cols: ContentDoc[][] = [[], []];
		items.forEach((item, i) => {
			cols[i % 2].push(item);
		});
		return cols;
	});
</script>

{#if loaded && items.length > 0}
	<div class="flex w-full overflow-hidden rounded-[inherit] h-full bg-surface">
		{#each columns.filter(c => c.length > 0) as col}
			<div class="flex-1 flex flex-col min-w-0 h-full">
				{#each col as item (item.id)}
					{@const thumb = getThumbnail(item)}
					<div class="flex-1 relative min-h-0 overflow-hidden border-[0.5px] border-white/10">
						{#if thumb}
							<img
								src={thumb}
								alt=""
								class="absolute inset-0 w-full h-full object-cover block"
								loading="lazy"
								onerror={(e) => (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'}
							/>
						{:else}
							{@const style = getTileStyle(item)}
							<div class="absolute inset-0 {style.bg} flex items-center justify-center p-4">
								<Icon icon={style.icon} class="{style.fg} text-6xl opacity-90 drop-shadow-sm" />
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
{:else if loaded}
	<!-- Empty board — subtle placeholder -->
	<div class="w-full h-full bg-gradient-to-br from-accent/5 to-accent/10 rounded-[inherit]
		flex items-center justify-center">
		<Icon icon="ph:squares-four" class="text-4xl text-muted/25" />
	</div>
{/if}
