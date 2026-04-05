<!--
  @file CardDetailModal.svelte
  @description Full-screen card detail view using Konsta Popup + Page.
               Unique, visually stunning presentation for each content type.
               Comments expanded by default. All actions (heart, comment, share, delete) work.
-->
<script lang="ts">
	import { Popup, Page, Button, List, ListItem, Checkbox, Badge, Progressbar } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import type {
		ContentDoc, ListContentDoc, NoteContentDoc, LinkContentDoc,
		ProductContentDoc, VoiceContentDoc, PhotoContentDoc, VideoContentDoc,
		LocationContentDoc, PollContentDoc
	} from '$lib/types';
	import { formatDurationMs } from '$lib/utils/dateFormatter';
	import { extractYouTubeId } from '$lib/utils/ogParser';
	import {
		isRecipeEnrichment, isMovieEnrichment, isBookEnrichment,
		isPlaceEnrichment, isMusicEnrichment, isArticleEnrichment, isGithubEnrichment
	} from '$lib/utils/enrichmentGuards';
	import CardFooterSection from './CardFooterSection.svelte';
	import { userStore } from '$lib/stores';
	import { voteOnPoll, subscribeToVotes } from '$lib/firebase/boardService';
	import { hapticLight } from '$lib/utils/haptics';
	import type { VoteDoc } from '$lib/types';

	let {
		item,
		boardId,
		isBoardOwner,
		allowComments,
		onClose,
		onDelete,
		onShare,
		onToggleListItem
	}: {
		item: ContentDoc;
		boardId: string;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		onClose: () => void;
		onDelete?: (item: ContentDoc) => void;
		onShare?: (item: ContentDoc) => void;
		onToggleListItem?: (contentItem: ListContentDoc, itemId: string) => void;
	} = $props();

	const createdAt = $derived(item.createdAt?.toDate?.() ?? new Date());

	// ── Photo state ──
	let currentPhotoIdx = $state(0);
	let photoError = $state(false);

	// ── Video state ──
	let videoPlaying = $state(false);
	let videoEl = $state<HTMLVideoElement | undefined>();

	// ── Voice state ──
	let audio = $state<HTMLAudioElement | undefined>();
	let voicePlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	const voiceProgress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	// ── Poll state ──
	let votes = $state<VoteDoc[]>([]);
	const totalVotes = $derived(votes.length);
	const userVote = $derived(votes.find(v => v.userId === $userStore.user?.uid));
	const voteCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const v of votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
		return counts;
	});

	$effect(() => {
		if (item.type === 'poll') {
			return subscribeToVotes(boardId, item.id, (v) => { votes = v; });
		}
	});

	$effect(() => {
		if (item.type === 'voice') {
			duration = (item as VoiceContentDoc).durationMs / 1000;
		}
	});

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function toggleVoice() {
		const voiceItem = item as VoiceContentDoc;
		if (!audio) {
			audio = new Audio(voiceItem.audioUrl);
			audio.addEventListener('timeupdate', () => { currentTime = audio!.currentTime; });
			audio.addEventListener('ended', () => { voicePlaying = false; currentTime = 0; });
		}
		if (voicePlaying) audio.pause(); else audio.play();
		voicePlaying = !voicePlaying;
	}

	function seekVoice(e: MouseEvent) {
		if (!audio) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const percent = (e.clientX - rect.left) / rect.width;
		audio.currentTime = percent * duration;
	}

	function toggleVideo() {
		if (!videoEl) return;
		if (videoPlaying) videoEl.pause(); else videoEl.play();
		videoPlaying = !videoPlaying;
	}

	// ── Link helpers ──
	function getLinkIcon(url: string, enrichment: any): string {
		if (extractYouTubeId(url)) return 'ph:youtube-logo-fill';
		if (enrichment) {
			if (isRecipeEnrichment(enrichment)) return 'ph:chef-hat-fill';
			if (isMovieEnrichment(enrichment)) return 'ph:film-strip-fill';
			if (isBookEnrichment(enrichment)) return 'ph:book-fill';
			if (isPlaceEnrichment(enrichment)) return 'ph:map-pin-fill';
			if (isMusicEnrichment(enrichment)) return 'ph:music-note-fill';
			if (isArticleEnrichment(enrichment)) return 'ph:newspaper-fill';
			if (isGithubEnrichment(enrichment)) return 'ph:github-logo-fill';
		}
		return 'ph:link-bold';
	}

	const SHORT_NOTE_THRESHOLD = 120;
	const isShortNote = $derived(
		item.type === 'note' && (item as NoteContentDoc).text.trim().length <= SHORT_NOTE_THRESHOLD
	);

</script>

<Popup opened={!!item} onBackdropClick={onClose}>
	<!-- Floating close button — z-50 to stay above iframes -->
	<button
		onclick={onClose}
		class="absolute top-3 right-3 z-50 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm
			flex items-center justify-center text-white press-scale"
		aria-label="Close"
	>
		<Icon icon="ph:x-bold" class="text-sm" />
	</button>

	<Page>
		<!-- ═══════════════ NOTE ═══════════════ -->
		{#if item.type === 'note'}
			{@const note = item as NoteContentDoc}
			{#if isShortNote}
				<!-- Short note: large quote style -->
				<div class="flex items-center min-h-[200px] px-6 pt-8 pb-4">
					<blockquote class="text-[24px] leading-[1.5] text-on-surface font-medium italic border-l-4 border-primary/30 pl-5">
						{note.text.trim()}
					</blockquote>
				</div>
			{:else}
				<!-- Long note: comfortable reading -->
				<div class="px-5 pt-8 pb-4">
					<p class="text-[17px] leading-[1.7] text-on-surface whitespace-pre-wrap font-[350]">{note.text.trim()}</p>
				</div>
			{/if}

		<!-- ═══════════════ PHOTO ═══════════════ -->
		{:else if item.type === 'photo'}
			{@const photo = item as PhotoContentDoc}
			{@const allImages = photo.images?.length > 0 ? photo.images : [{ url: photo.imageUrl, width: photo.width, height: photo.height }]}
			{@const isMulti = allImages.length > 1}

			<div class="relative bg-black">
				{#if !photoError}
					<img
						src={allImages[currentPhotoIdx]?.url || photo.imageUrl}
						alt={photo.caption || 'Photo'}
						class="w-full max-h-[60vh] object-contain"
						loading="lazy"
						onerror={() => { photoError = true; }}
					/>
				{:else}
					<div class="flex items-center justify-center h-48 text-muted">
						<Icon icon="ph:image-broken" class="text-4xl" />
					</div>
				{/if}

				{#if isMulti}
					<button onclick={(e) => { e.stopPropagation(); currentPhotoIdx = (currentPhotoIdx - 1 + allImages.length) % allImages.length; }}
						class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center press-scale">
						<Icon icon="ph:caret-left-bold" class="text-base" />
					</button>
					<button onclick={(e) => { e.stopPropagation(); currentPhotoIdx = (currentPhotoIdx + 1) % allImages.length; }}
						class="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center press-scale">
						<Icon icon="ph:caret-right-bold" class="text-base" />
					</button>

					<div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
						{#each allImages as _, i (i)}
							<div class="rounded-full transition-all duration-200 {i === currentPhotoIdx ? 'w-5 h-2 bg-white' : 'w-2 h-2 bg-white/50'}"></div>
						{/each}
					</div>

					<div class="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm">
						<span class="text-[12px] text-white font-semibold tabular-nums">{currentPhotoIdx + 1}/{allImages.length}</span>
					</div>
				{/if}
			</div>

			{#if photo.caption}
				<div class="px-5 pt-4 pb-2">
					<p class="text-[15px] text-on-surface leading-relaxed">{photo.caption}</p>
				</div>
			{/if}

		<!-- ═══════════════ VIDEO ═══════════════ -->
		{:else if item.type === 'video'}
			{@const video = item as VideoContentDoc}

			<div class="relative bg-black">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={videoEl}
					src={video.videoUrl}
					poster={video.thumbnailUrl}
					class="w-full max-h-[60vh] object-contain"
					onplay={() => { videoPlaying = true; }}
					onpause={() => { videoPlaying = false; }}
					onended={() => { videoPlaying = false; }}
					controls={videoPlaying}
				/>

				{#if !videoPlaying}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer" onclick={toggleVideo}>
						<div class="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center press-scale ring-2 ring-white/30">
							<Icon icon="ph:play-fill" class="text-3xl text-white ml-1" />
						</div>
					</div>
				{/if}

				<div class="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm">
					<span class="text-[12px] font-semibold text-white">{formatDurationMs(video.durationMs)}</span>
				</div>
			</div>

			{#if video.caption}
				<div class="px-5 pt-4 pb-2">
					<p class="text-[15px] text-on-surface leading-relaxed">{video.caption}</p>
				</div>
			{/if}

		<!-- ═══════════════ LINK ═══════════════ -->
		{:else if item.type === 'link'}
			{@const link = item as LinkContentDoc}
			{@const youtubeId = extractYouTubeId(link.url)}

			{#if youtubeId}
				<div class="relative z-0 bg-black aspect-video">
					<iframe
						src="https://www.youtube.com/embed/{youtubeId}?autoplay=0"
						title={link.title}
						class="w-full h-full"
						frameborder="0"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowfullscreen
					></iframe>
				</div>
				<div class="px-5 pt-4 pb-2">
					<h2 class="text-[18px] font-bold text-on-surface leading-snug">{link.title}</h2>
					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed mt-2">{link.description}</p>
					{/if}
				</div>

			{:else if link.enrichment && isRecipeEnrichment(link.enrichment)}
				<!-- ──── RECIPE DETAIL ──── -->
				{@const recipe = link.enrichment}
				{#if link.image}
					<div class="relative bg-surface-1 overflow-hidden">
						<img src={link.image} alt={link.title} class="w-full max-h-[280px] object-cover" loading="lazy" />
						<div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
						<div class="absolute bottom-3 left-3 flex items-center gap-2">
							<div class="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
								<Icon icon="ph:chef-hat-fill" class="text-sm text-white" />
							</div>
							<span class="text-[12px] text-white/90 font-semibold">{link.domain}</span>
						</div>
					</div>
				{/if}
				<div class="px-5 pt-4 pb-2">
					<h2 class="text-[18px] font-bold text-on-surface leading-snug">{link.title}</h2>
					<!-- Quick-glance pills -->
					<div class="flex flex-wrap gap-2 mt-3">
						{#if recipe.totalTime}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-[12px] font-medium text-amber-700">
								<Icon icon="ph:timer" class="text-xs" />{recipe.totalTime}
							</span>
						{/if}
						{#if recipe.prepTime && recipe.prepTime !== recipe.totalTime}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-1 text-[12px] font-medium text-muted">
								Prep {recipe.prepTime}
							</span>
						{/if}
						{#if recipe.cookTime && recipe.cookTime !== recipe.totalTime}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-1 text-[12px] font-medium text-muted">
								Cook {recipe.cookTime}
							</span>
						{/if}
						{#if recipe.servings}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-[12px] font-medium text-emerald-700">
								<Icon icon="ph:users" class="text-xs" />{recipe.servings}
							</span>
						{/if}
						{#if recipe.calories}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-[12px] font-medium text-orange-700">
								<Icon icon="ph:fire" class="text-xs" />{recipe.calories}
							</span>
						{/if}
						{#if recipe.cuisine}
							<span class="px-2.5 py-1 rounded-full bg-pink-500/10 text-[12px] font-medium text-pink-700">
								{recipe.cuisine}
							</span>
						{/if}
					</div>

					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed mt-3">{link.description}</p>
					{/if}

					<!-- Ingredients -->
					{#if recipe.ingredients.length > 0}
						<div class="mt-5">
							<h3 class="text-[15px] font-bold text-on-surface flex items-center gap-1.5">
								<Icon icon="ph:list-bullets" class="text-base text-amber-600" />
								Ingredients
								<span class="text-[12px] font-normal text-muted ml-1">({recipe.ingredients.length})</span>
							</h3>
							<ul class="mt-2.5 space-y-1.5">
								{#each recipe.ingredients as ingredient}
									<li class="flex items-start gap-2.5 text-[14px] text-on-surface leading-relaxed">
										<span class="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0"></span>
										{ingredient}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- Instructions -->
					{#if recipe.instructions.length > 0}
						<div class="mt-5">
							<h3 class="text-[15px] font-bold text-on-surface flex items-center gap-1.5">
								<Icon icon="ph:cooking-pot" class="text-base text-amber-600" />
								Instructions
							</h3>
							<ol class="mt-2.5 space-y-3">
								{#each recipe.instructions as step, i}
									<li class="flex gap-3">
										<span class="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
											<span class="text-[11px] font-bold text-amber-700">{i + 1}</span>
										</span>
										<p class="text-[14px] text-on-surface leading-relaxed flex-1">{step}</p>
									</li>
								{/each}
							</ol>
						</div>
					{/if}
				</div>

			{:else if link.enrichment && isMovieEnrichment(link.enrichment)}
				<!-- ──── MOVIE/TV DETAIL ──── -->
				{@const movie = link.enrichment}
				{#if link.image}
					<div class="relative bg-surface-1 overflow-hidden">
						<img src={link.image} alt={link.title} class="w-full max-h-[350px] object-cover" loading="lazy" />
						<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
						<div class="absolute bottom-3 left-4 right-4">
							<h2 class="text-[20px] font-bold text-white leading-snug drop-shadow-lg">{link.title}</h2>
							<div class="flex flex-wrap items-center gap-2 mt-1.5">
								{#if movie.year}
									<span class="text-[12px] text-white/80 font-medium">{movie.year}</span>
								{/if}
								{#if movie.runtime}
									<span class="text-[10px] text-white/40">·</span>
									<span class="text-[12px] text-white/80">{movie.runtime}</span>
								{/if}
								{#if movie.contentRating}
									<span class="px-1.5 py-0.5 rounded border border-white/30 text-[10px] text-white/80 font-semibold">{movie.contentRating}</span>
								{/if}
							</div>
						</div>
					</div>
				{:else}
					<div class="px-5 pt-8">
						<h2 class="text-[20px] font-bold text-on-surface leading-snug">{link.title}</h2>
					</div>
				{/if}
				<div class="px-5 pt-4 pb-2">
					{#if movie.rating}
						<div class="flex items-center gap-2 mb-3">
							<div class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/10">
								<Icon icon="ph:star-fill" class="text-base text-amber-500" />
								<span class="text-[15px] font-bold text-amber-700">{movie.rating}</span>
								{#if movie.ratingSource}
									<span class="text-[11px] text-amber-700/60">{movie.ratingSource}</span>
								{/if}
							</div>
							{#if movie.genre}
								<span class="text-[12px] text-muted">{movie.genre}</span>
							{/if}
						</div>
					{/if}
					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed">{link.description}</p>
					{/if}
					{#if movie.director}
						<div class="mt-3 flex items-center gap-2">
							<span class="text-[12px] font-semibold text-on-surface/60">Director</span>
							<span class="text-[13px] text-on-surface">{movie.director}</span>
						</div>
					{/if}
					{#if movie.cast?.length > 0}
						<div class="mt-2">
							<span class="text-[12px] font-semibold text-on-surface/60">Cast</span>
							<p class="text-[13px] text-on-surface mt-0.5">{movie.cast.slice(0, 6).join(', ')}</p>
						</div>
					{/if}
				</div>

			{:else if link.enrichment && isBookEnrichment(link.enrichment)}
				<!-- ──── BOOK DETAIL ──── -->
				{@const book = link.enrichment}
				<div class="flex gap-4 px-5 pt-8 pb-2">
					{#if link.image}
						<img src={link.image} alt={link.title}
							class="w-28 h-auto rounded-lg shadow-lg object-cover shrink-0" loading="lazy" />
					{/if}
					<div class="flex-1 min-w-0">
						<h2 class="text-[18px] font-bold text-on-surface leading-snug">{link.title}</h2>
						{#if book.author}
							<p class="text-[14px] text-muted mt-1">by {book.author}</p>
						{/if}
						{#if book.averageRating}
							<div class="flex items-center gap-1 mt-2">
								<Icon icon="ph:star-fill" class="text-sm text-amber-500" />
								<span class="text-[14px] font-semibold text-amber-700">{book.averageRating}</span>
							</div>
						{/if}
						<div class="flex flex-wrap gap-1.5 mt-2.5">
							{#if book.pageCount}
								<span class="px-2 py-0.5 rounded-full bg-surface-1 text-[11px] font-medium text-muted">{book.pageCount} pages</span>
							{/if}
							{#if book.genre}
								<span class="px-2 py-0.5 rounded-full bg-surface-1 text-[11px] font-medium text-muted">{book.genre}</span>
							{/if}
						</div>
					</div>
				</div>
				<div class="px-5 pb-2">
					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed mt-2">{link.description}</p>
					{/if}
					{#if book.publisher}
						<p class="text-[12px] text-muted mt-3">
							Published by {book.publisher}{book.publishDate ? ` · ${book.publishDate}` : ''}
						</p>
					{/if}
					{#if book.isbn}
						<p class="text-[11px] text-muted/60 mt-1">ISBN {book.isbn}</p>
					{/if}
				</div>

			{:else if link.enrichment && isPlaceEnrichment(link.enrichment)}
				<!-- ──── PLACE DETAIL ──── -->
				{@const place = link.enrichment}
				{#if link.image}
					<div class="relative bg-surface-1 overflow-hidden">
						<img src={link.image} alt={link.title} class="w-full max-h-[250px] object-cover" loading="lazy" />
						<div class="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
							<Icon icon="ph:map-pin-fill" class="text-xs text-white" />
							<span class="text-[11px] text-white/90 font-medium">{link.domain}</span>
						</div>
					</div>
				{/if}
				<div class="px-5 pt-4 pb-2">
					<h2 class="text-[18px] font-bold text-on-surface leading-snug">{link.title}</h2>
					{#if place.category}
						<p class="text-[13px] text-muted mt-0.5">{place.category}</p>
					{/if}
					<div class="flex flex-wrap items-center gap-2 mt-2.5">
						{#if place.rating}
							<div class="flex items-center gap-1">
								<Icon icon="ph:star-fill" class="text-sm text-amber-500" />
								<span class="text-[14px] font-semibold text-amber-700">{place.rating}</span>
								{#if place.ratingCount}
									<span class="text-[12px] text-muted">({place.ratingCount})</span>
								{/if}
							</div>
						{/if}
						{#if place.priceRange}
							<span class="text-[13px] text-muted font-medium">{place.priceRange}</span>
						{/if}
					</div>
					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed mt-3">{link.description}</p>
					{/if}
					{#if place.address}
						<div class="flex items-start gap-2 mt-3 text-[13px] text-on-surface">
							<Icon icon="ph:map-pin" class="text-base text-muted mt-0.5 shrink-0" />
							<span>{place.address}</span>
						</div>
					{/if}
					{#if place.phone}
						<div class="flex items-center gap-2 mt-1.5 text-[13px] text-on-surface">
							<Icon icon="ph:phone" class="text-base text-muted shrink-0" />
							<a href="tel:{place.phone}" class="text-primary">{place.phone}</a>
						</div>
					{/if}
					{#if place.hours}
						<div class="flex items-start gap-2 mt-1.5 text-[13px] text-muted">
							<Icon icon="ph:clock" class="text-base mt-0.5 shrink-0" />
							<span>{place.hours}</span>
						</div>
					{/if}
					{#if place.latitude && place.longitude}
						<a href="https://www.google.com/maps?q={place.latitude},{place.longitude}" target="_blank" rel="noopener noreferrer" class="mt-4 block">
							<Button large rounded class="w-full">
								<Icon icon="ph:navigation-arrow" class="mr-2 text-lg" />
								Open in Maps
							</Button>
						</a>
					{/if}
				</div>

			{:else if link.enrichment && isMusicEnrichment(link.enrichment)}
				<!-- ──── MUSIC DETAIL ──── -->
				{@const music = link.enrichment}
				<div class="flex flex-col items-center px-5 pt-10 pb-2">
					{#if link.image}
						<img src={link.image} alt={link.title}
							class="w-48 h-48 rounded-2xl shadow-xl object-cover" loading="lazy" />
					{:else}
						<div class="w-48 h-48 rounded-2xl bg-violet-500/10 flex items-center justify-center">
							<Icon icon="ph:music-note-fill" class="text-6xl text-violet-500/30" />
						</div>
					{/if}
					<h2 class="text-[18px] font-bold text-on-surface leading-snug text-center mt-4">{link.title}</h2>
					{#if music.artist}
						<p class="text-[15px] text-muted mt-1">{music.artist}</p>
					{/if}
					<div class="flex flex-wrap justify-center gap-2 mt-3">
						{#if music.album}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-500/10 text-[12px] font-medium text-violet-700">
								<Icon icon="ph:vinyl-record" class="text-xs" />{music.album}
							</span>
						{/if}
						{#if music.duration}
							<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-1 text-[12px] font-medium text-muted">
								<Icon icon="ph:clock" class="text-xs" />{music.duration}
							</span>
						{/if}
						{#if music.genre}
							<span class="px-2.5 py-1 rounded-full bg-surface-1 text-[12px] font-medium text-muted">{music.genre}</span>
						{/if}
					</div>
				</div>

			{:else if link.enrichment && isArticleEnrichment(link.enrichment)}
				<!-- ──── ARTICLE READER ──── -->
				{@const article = link.enrichment}
				{#if link.image}
					<div class="relative bg-surface-1 overflow-hidden">
						<img src={link.image} alt={link.title} class="w-full max-h-[250px] object-cover" loading="lazy" />
					</div>
				{/if}
				<div class="px-5 pt-5 pb-2">
					{#if article.siteName}
						<p class="text-[12px] font-semibold text-primary uppercase tracking-wide">{article.siteName}</p>
					{/if}
					<h2 class="text-[20px] font-bold text-on-surface leading-snug mt-1">{link.title}</h2>
					<div class="flex items-center gap-2 mt-2 text-[13px] text-muted">
						{#if article.author}
							<span class="font-medium text-on-surface/70">{article.author}</span>
						{/if}
						{#if article.publishedDate}
							{#if article.author}<span class="text-muted/40">·</span>{/if}
							<span>{article.publishedDate}</span>
						{/if}
						{#if article.readingTime}
							<span class="text-muted/40">·</span>
							<span>{article.readingTime}</span>
						{/if}
					</div>
					<!-- Article body or description -->
					{#if article.bodyText}
						<div class="mt-4 text-[15px] text-on-surface leading-[1.8] whitespace-pre-wrap font-[350] article-body">
							{article.bodyText}
						</div>
					{:else if link.description}
						<p class="text-[15px] text-on-surface/80 leading-[1.8] mt-4 font-[350]">{link.description}</p>
					{/if}
				</div>

			{:else if link.enrichment && isGithubEnrichment(link.enrichment)}
				<!-- ──── GITHUB DETAIL ──── -->
				{@const gh = link.enrichment}
				<div class="px-5 pt-8 pb-2">
					<div class="flex items-center gap-3 mb-3">
						{#if link.image}
							<img src={link.image} alt={gh.owner ?? ''} class="w-12 h-12 rounded-full" loading="lazy" />
						{:else}
							<div class="w-12 h-12 rounded-full bg-surface-1 flex items-center justify-center">
								<Icon icon="ph:github-logo-fill" class="text-2xl text-on-surface/30" />
							</div>
						{/if}
						<div>
							<h2 class="text-[17px] font-bold text-on-surface">{gh.owner}/{gh.repo}</h2>
							{#if gh.language}
								<span class="text-[12px] text-muted">{gh.language}</span>
							{/if}
						</div>
					</div>
					{#if gh.description}
						<p class="text-[14px] text-muted leading-relaxed">{gh.description}</p>
					{/if}
					<div class="flex items-center gap-4 mt-3">
						{#if gh.stars}
							<div class="flex items-center gap-1">
								<Icon icon="ph:star-fill" class="text-sm text-amber-500" />
								<span class="text-[13px] font-semibold text-on-surface">{gh.stars}</span>
							</div>
						{/if}
						{#if gh.forks}
							<div class="flex items-center gap-1">
								<Icon icon="ph:git-fork" class="text-sm text-muted" />
								<span class="text-[13px] font-semibold text-on-surface">{gh.forks}</span>
							</div>
						{/if}
					</div>
				</div>

			{:else}
				<!-- ──── DEFAULT LINK ──── -->
				{#if link.image}
					<div class="relative bg-surface-1 overflow-hidden">
						<img src={link.image} alt={link.title} class="w-full max-h-[300px] object-cover" loading="lazy" />
						<div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
						<div class="absolute bottom-3 left-3 flex items-center gap-2">
							<div class="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
								<Icon icon={getLinkIcon(link.url, link.enrichment)} class="text-sm text-white" />
							</div>
							<span class="text-[12px] text-white/90 font-semibold">{link.domain}</span>
						</div>
					</div>
				{/if}
				<div class="px-5 pt-4 pb-2">
					{#if !link.image}
						<div class="flex items-center gap-2.5 mb-3">
							<div class="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
								<Icon icon={getLinkIcon(link.url, link.enrichment)} class="text-xl text-on-surface" />
							</div>
							<span class="text-[12px] text-muted font-medium">{link.domain}</span>
						</div>
					{/if}
					<h2 class="text-[18px] font-bold text-on-surface leading-snug">{link.title}</h2>
					{#if link.description}
						<p class="text-[14px] text-muted leading-relaxed mt-2">{link.description}</p>
					{/if}
				</div>
			{/if}

			<!-- CTA button (all link variants except places which have Maps button) -->
			{#if !(link.enrichment && isPlaceEnrichment(link.enrichment) && link.enrichment.latitude)}
				<div class="px-5 pb-2">
					<a href={link.url} target="_blank" rel="noopener noreferrer" class="mt-4 block">
						<Button large rounded class="w-full">
							<Icon icon={link.enrichment && isRecipeEnrichment(link.enrichment) ? 'ph:chef-hat' : link.enrichment && isGithubEnrichment(link.enrichment) ? 'ph:github-logo' : 'ph:arrow-square-out'} class="mr-2 text-lg" />
							{#if link.enrichment && isRecipeEnrichment(link.enrichment)}
								View Original Recipe
							{:else if link.enrichment && isGithubEnrichment(link.enrichment)}
								Open on GitHub
							{:else if link.enrichment && isMusicEnrichment(link.enrichment)}
								Listen
							{:else}
								Open Link
							{/if}
						</Button>
					</a>
				</div>
			{/if}

		<!-- ═══════════════ PRODUCT ═══════════════ -->
		{:else if item.type === 'product'}
			{@const product = item as ProductContentDoc}

			{#if product.image}
				<div class="relative bg-surface-1 overflow-hidden">
					<img src={product.image} alt={product.title} class="w-full max-h-[300px] object-cover" loading="lazy" />
					{#if product.priceDrop}
						<div class="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 shadow-lg">
							<Icon icon="ph:trend-down-fill" class="text-sm text-white" />
							<span class="text-[12px] text-white font-bold">Price Drop</span>
						</div>
					{/if}
				</div>
			{/if}

			<div class="px-5 pt-4 pb-2">
				<div class="flex items-baseline gap-3 mb-2">
					<span class="text-2xl font-bold text-type-product">{product.price}</span>
					{#if product.originalPrice && product.originalPrice !== product.price}
						<span class="text-base text-muted line-through">{product.originalPrice}</span>
					{/if}
				</div>

				<h2 class="text-[17px] font-semibold text-on-surface leading-snug">{product.title}</h2>

				{#if product.domain}
					<div class="flex items-center gap-1.5 mt-2">
						<Icon icon="ph:storefront" class="text-sm text-on-surface/50" />
						<span class="text-[12px] text-muted font-medium">{product.domain}</span>
					</div>
				{/if}

				<a href={product.url} target="_blank" rel="noopener noreferrer" class="mt-4 block">
					<Button large rounded class="w-full">
						<Icon icon="ph:shopping-bag" class="mr-2 text-lg" />
						View Product
					</Button>
				</a>
			</div>

		<!-- ═══════════════ VOICE ═══════════════ -->
		{:else if item.type === 'voice'}
			{@const voice = item as VoiceContentDoc}
			{@const voiceBarCount = 48}
			{@const voiceBarHeights = Array.from({ length: voiceBarCount }, () => 12 + Math.random() * 28)}

			<div class="px-5 pt-14 pb-4">
				<!-- Full-width waveform with overlaid play button -->
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div
					class="relative w-full h-16 bg-surface-1 rounded-2xl cursor-pointer flex items-center px-2 overflow-hidden"
					onclick={seekVoice}
				>
					<!-- Progress fill -->
					<div class="absolute inset-0 bg-type-voice/8 origin-left transition-[transform] duration-100"
						style="transform: scaleX({voiceProgress / 100})"></div>

					<!-- Bars -->
					<div class="relative flex items-end gap-[2px] flex-1 h-full py-2">
						{#each voiceBarHeights as h, i}
							<div
								class="flex-1 min-w-[2px] max-w-[4px] rounded-full transition-colors duration-100
									{i / voiceBarCount < voiceProgress / 100 ? 'bg-type-voice' : 'bg-type-voice/20'}"
								style="height: {h}px"
							></div>
						{/each}
					</div>

					<!-- Centered play/pause overlay -->
					<button
						onclick={(e) => { e.stopPropagation(); toggleVoice(); }}
						class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-type-voice/15
							flex items-center justify-center press-scale backdrop-blur-sm"
					>
						<Icon icon={voicePlaying ? 'ph:pause-fill' : 'ph:play-fill'}
							class="text-lg text-type-voice {voicePlaying ? '' : 'ml-0.5'}" />
					</button>
				</div>

				<!-- Time row -->
				<div class="flex items-center justify-between mt-2 px-1">
					<span class="text-[12px] text-muted font-medium tabular-nums">{formatTime(currentTime)}</span>
					<span class="text-[12px] text-muted font-medium tabular-nums">{formatTime(duration)}</span>
				</div>
			</div>

		<!-- ═══════════════ LIST ═══════════════ -->
		{:else if item.type === 'list'}
			{@const list = item as ListContentDoc}
			{@const completedCount = list.items.filter(i => i.completed).length}
			{@const totalCount = list.items.length}
			{@const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0}

			<div class="px-5 pt-14 pb-2">
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-[18px] font-bold text-on-surface">{list.title}</h2>
					<Badge colors={{ bg: completedCount === totalCount ? 'bg-emerald-500' : 'bg-blue-500' }}>
						{completedCount}/{totalCount}
					</Badge>
				</div>

				<Progressbar progress={progress} class="mb-4" />
			</div>

			<List strong inset>
				{#each list.items as listItem (listItem.id)}
					{#snippet listMedia()}
						<Checkbox
							checked={listItem.completed}
							onchange={() => onToggleListItem?.(item as ListContentDoc, listItem.id)}
						/>
					{/snippet}
					<ListItem
						title={listItem.text}
						media={listMedia}
						class={listItem.completed ? 'opacity-50 line-through' : ''}
					/>
				{/each}
			</List>

		<!-- ═══════════════ POLL ═══════════════ -->
		{:else if item.type === 'poll'}
			{@const poll = item as PollContentDoc}

			<div class="px-5 pt-14 pb-2">
				<h2 class="text-[18px] font-bold text-on-surface leading-snug mb-4">{poll.question}</h2>

				<div class="flex flex-col gap-2.5">
					{#each poll.options as opt}
						{@const percent = totalVotes > 0 ? ((voteCounts.get(opt.id) ?? 0) / totalVotes) * 100 : 0}
						{@const isSelected = userVote?.optionId === opt.id}

						<button
							onclick={() => { if ($userStore.user) { hapticLight(); voteOnPoll(boardId, item.id, $userStore.user.uid, opt.id); } }}
							class="relative w-full text-left px-4 py-3.5 rounded-2xl border-2 transition-all overflow-hidden
								{isSelected ? 'border-accent bg-accent/5' : 'border-border bg-surface-1 hover:border-accent/20'}"
						>
							<div class="absolute inset-0 bg-accent/8 origin-left transition-transform duration-500 ease-out"
								style="transform: scaleX({percent / 100})"></div>

							<div class="relative flex items-center justify-between gap-2">
								<span class="text-[14px] font-medium {isSelected ? 'text-accent' : 'text-on-surface'}">{opt.text}</span>
								<div class="flex items-center gap-2 shrink-0">
									{#if isSelected}
										<Icon icon="ph:check-circle-fill" class="text-accent text-base" />
									{/if}
									{#if totalVotes > 0}
										<span class="text-[12px] text-muted font-semibold tabular-nums">{Math.round(percent)}%</span>
									{/if}
								</div>
							</div>
						</button>
					{/each}
				</div>

				<p class="text-[11px] text-muted font-medium mt-3 text-center">
					{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
				</p>
			</div>

		<!-- ═══════════════ LOCATION ═══════════════ -->
		{:else if item.type === 'location'}
			{@const loc = item as LocationContentDoc}

			<div class="bg-surface-1 h-48 flex items-center justify-center">
				<div class="flex flex-col items-center gap-2 text-muted">
					<div class="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center">
						<Icon icon="ph:map-pin-fill" class="text-3xl text-on-surface" />
					</div>
				</div>
			</div>

			<div class="px-5 pt-4 pb-2">
				{#if loc.name}
					<h2 class="text-[18px] font-bold text-on-surface">{loc.name}</h2>
				{/if}
				{#if loc.address}
					<p class="text-[14px] text-muted leading-relaxed mt-1">{loc.address}</p>
				{/if}

				<a href="https://www.google.com/maps?q={loc.latitude},{loc.longitude}" target="_blank" rel="noopener noreferrer" class="mt-4 block">
					<Button large rounded class="w-full">
						<Icon icon="ph:navigation-arrow" class="mr-2 text-lg" />
						Open in Maps
					</Button>
				</a>
			</div>
		{/if}

		<!-- ═══════════════ FOOTER: Author + Interactions + Comments ═══════════════ -->
		<div class="border-t border-surface-1 mt-2">
			<CardFooterSection
				{boardId}
				contentId={item.id}
				authorId={item.authorId}
				authorName={item.authorName}
				authorPhotoURL={item.authorPhotoURL}
				{createdAt}
				{isBoardOwner}
				{allowComments}
				expandComments={true}
				commentCount={item.commentCount}
				acknowledgments={item.acknowledgments}
				onDelete={onDelete ? () => onDelete(item) : undefined}
				onShare={onShare ? () => onShare(item) : undefined}
			/>
		</div>
	</Page>
</Popup>
