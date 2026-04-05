<!--
  @file YouTubeEmbed.svelte
  @description YouTube video with lazy-loaded iframe. Polished play button with red glow.
               In modal context: tap thumbnail to load iframe with autoplay (works on mobile).
               The iframe only loads on explicit user tap, satisfying mobile autoplay policies.
-->
<script lang="ts">
	import { getContext } from 'svelte';
	import { browser } from '$app/environment';
	import Icon from '@iconify/svelte';
	import LinkSourceBar from './LinkSourceBar.svelte';

	let {
		url,
		title,
		description,
		image,
		youtubeId,
		domain,
		favicon
	}: {
		url: string;
		title: string;
		description: string | null;
		image: string | null;
		youtubeId: string;
		domain: string;
		favicon: string | null;
	} = $props();

	const isExpanded = getContext<boolean>('card-detail-expanded') ?? false;

	// Never auto-load iframe — always show thumbnail first.
	// User taps play → iframe loads with autoplay=1&mute=1 (satisfies mobile policy).
	let loaded = $state(false);
	let imageError = $state(false);
	const thumbnail = $derived(image ?? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`);

	function play() {
		loaded = true;
	}
</script>

{#if loaded}
	<div class="relative w-full" style="padding-bottom: 56.25%;">
		<iframe
			src="https://www.youtube-nocookie.com/embed/{youtubeId}?rel=0&playsinline=1&enablejsapi=1&autoplay=1&mute=1"
			{title}
			class="absolute inset-0 w-full h-full"
			frameborder="0"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
			allowfullscreen
		></iframe>
	</div>
{:else}
	<button
		onclick={play}
		class="relative block w-full group cursor-pointer overflow-hidden"
	>
		{#if !imageError}
			<img src={thumbnail} alt={title}
				class="w-full aspect-video object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
				onerror={() => (imageError = true)} />
		{:else}
			<div class="w-full aspect-video bg-primary flex items-center justify-center">
				<Icon icon="ph:youtube-logo-fill" class="text-red-500 text-5xl opacity-30" />
			</div>
		{/if}
		<div class="absolute inset-0 bg-black/25 flex items-center justify-center group-hover:bg-black/35 transition-colors duration-300">
			<div class="play-btn w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-xl transition-all duration-300 group-hover:scale-105 group-hover:shadow-red-600/40 group-hover:shadow-2xl">
				<Icon icon="ph:play-fill" class="text-white text-3xl ml-0.5" />
			</div>
		</div>
		<!-- Duration overlay -->
		<div class="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[11px] text-white font-semibold tabular-nums">
			YouTube
		</div>
	</button>
{/if}

<div class="px-4 py-3">
	<LinkSourceBar {domain} {favicon} />
	<a href={url} target="_blank" rel="noopener noreferrer" class="block group/link">
		<h3 class="font-semibold text-primary text-[15px] leading-snug line-clamp-2 group-hover/link:text-accent transition-colors tracking-tight">{title}</h3>
	</a>
	{#if isExpanded && description}
		<p class="text-muted/70 text-[13px] mt-1.5 line-clamp-3 leading-relaxed">{description}</p>
	{/if}
</div>

<style>
	.play-btn {
		box-shadow: 0 4px 20px rgba(220, 38, 38, 0.3), 0 0 0 0 rgba(220, 38, 38, 0);
	}
</style>
