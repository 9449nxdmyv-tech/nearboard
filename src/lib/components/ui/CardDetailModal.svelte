<!--
  @file CardDetailModal.svelte
  @description Full-screen card detail view with YouTube-like layout.
               Sticky media at top, scrollable content below.
               Author, interactions, and single-comment preview row.
               Exhaustive support for all link variants (Movie, Book, Place, Music, Github, etc.)
-->
<script lang="ts">
	import { Popup, Page, Button, Checkbox, Progressbar, Actions, ActionsGroup, ActionsButton } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import MetadataPill from '$lib/components/cards/link/MetadataPill.svelte';
	import type {
		ContentDoc, ListContentDoc, NoteContentDoc, LinkContentDoc,
		ProductContentDoc, VoiceContentDoc, PhotoContentDoc, VideoContentDoc,
		LocationContentDoc, PollContentDoc, CommentDoc
	} from '$lib/types';
	import { formatDurationMs } from '$lib/utils/dateFormatter';
	import { extractYouTubeId } from '$lib/utils/urlUtils';
	import {
		isRecipeEnrichment, isMovieEnrichment, isBookEnrichment,
		isPlaceEnrichment, isMusicEnrichment, isArticleEnrichment, isGithubEnrichment,
		isVideoEnrichment, isProductEnrichment
	} from '$lib/utils/enrichmentGuards';
	import CardAcknowledgmentButton from './CardAcknowledgmentButton.svelte';
	import CardComments from './CardComments.svelte';
	import MapView from './MapView.svelte';
	import { userStore } from '$lib/stores';
	import { voteOnPoll, subscribeToVotes, subscribeToComments } from '$lib/firebase/boardService';
	import { hapticLight } from '$lib/utils/haptics';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import type { VoteDoc } from '$lib/types';

	// ── Swipe back to close modal (iOS-like edge swipe) ──
	let swipeStartX = $state(0);
	let swipeStartY = $state(0);
	let isSwiping = $state(false);
	let swipeDeltaX = $state(0);
	let swipeDirection: 'horizontal' | 'vertical' | null = $state(null);
	const SWIPE_THRESHOLD = 80;
	const EDGE_THRESHOLD = 40;

	function onModalTouchStart(e: TouchEvent) {
		const touch = e.touches[0];
		if (touch.clientX > EDGE_THRESHOLD) return;

		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, button, a, [data-no-swipe]')) return;

		isSwiping = true;
		swipeStartX = touch.clientX;
		swipeStartY = touch.clientY;
		swipeDeltaX = 0;
		swipeDirection = null;
	}

	function onModalTouchMove(e: TouchEvent) {
		if (!isSwiping) return;

		const touch = e.touches[0];
		const dx = touch.clientX - swipeStartX;
		const dy = touch.clientY - swipeStartY;

		// Lock direction after 8px of movement
		if (!swipeDirection && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
			swipeDirection = Math.abs(dx) / (Math.abs(dy) + 0.1) > 1.2 ? 'horizontal' : 'vertical';
			if (swipeDirection === 'vertical') { isSwiping = false; swipeDeltaX = 0; return; }
		}

		if (swipeDirection === 'horizontal' && dx > 0) {
			swipeDeltaX = dx;
		}
	}

	function onModalTouchEnd() {
		if (!isSwiping) return;
		isSwiping = false;

		if (swipeDeltaX > SWIPE_THRESHOLD) {
			hapticLight();
			onClose();
		}
		swipeDeltaX = 0;
		swipeDirection = null;
	}

	function onModalTouchCancel() {
		isSwiping = false;
		swipeDeltaX = 0;
		swipeDirection = null;
	}

	const swipeTransform = $derived(
		swipeDeltaX > 0
			? `translateX(${swipeDeltaX}px)`
			: ''
	);
	const swipeOpacity = $derived(
		swipeDeltaX > 0
			? Math.max(0.3, 1 - swipeDeltaX / 400)
			: 1
	);

	let {
		item,
		boardId,
		isBoardOwner,
		allowComments,
		expandComments = false,
		onClose,
		onDelete,
		onShare,
		onToggleListItem,
		resolveAuthorPhoto
	}: {
		item: ContentDoc;
		boardId: string;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		expandComments?: boolean;
		onClose: () => void;
		onDelete?: (item: ContentDoc) => void;
		onShare?: (item: ContentDoc) => void;
		onToggleListItem?: (contentItem: ListContentDoc, itemId: string) => void;
		/** Resolve author photo from current member data. Falls back to item.authorPhotoURL. */
		resolveAuthorPhoto?: (authorId: string, snapshotUrl: string | null) => string | null;
	} = $props();

	/** Resolve the current author photo using the provided resolver, or fall back to the snapshot */
	const resolvedAuthorPhoto = $derived(
		resolveAuthorPhoto
			? resolveAuthorPhoto(item.authorId, item.authorPhotoURL)
			: item.authorPhotoURL
	);

	const createdAt = $derived(item.createdAt?.toDate?.() ?? new Date());
	let authorImageError = $state(false);
	let commentImageError = $state(false);

	$effect(() => { authorImageError = false; commentImageError = false; });

	// ── Photo state ──
	let currentPhotoIdx = $state(0);
	let photoError = $state(false);
	let photoPointerDown = $state(false);
	let photoStartX = $state(0);
	let photoStartY = $state(0);
	let photoDragX = $state(0);
	let photoSwiping = $state(false);

	// ── Video state ──
	let videoPlaying = $state(false);
	let videoEl = $state<HTMLVideoElement | undefined>();

	// ── Voice state ──
	let audio = $state<HTMLAudioElement | undefined>();
	let voicePlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let voiceWaveformWidth = $state(0);
	const voiceProgress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	// Generate bar count based on container width (~4px per bar + 2px gap)
	const voiceBarCount = $derived(Math.max(20, Math.floor((voiceWaveformWidth - 16) / 6)));
	const voiceBarSeed = $derived(voiceBarCount);
	const voiceBarHeights = $derived(
		Array.from({ length: voiceBarCount }, (_, i) => {
			const x = Math.sin(i * 127.1 + voiceBarSeed * 0.01) * 43758.5453;
			return 12 + (x - Math.floor(x)) * 28;
		})
	);

	// ── Poll state ──
	let votes = $state<VoteDoc[]>([]);
	const totalVotes = $derived(votes.length);
	const userVote = $derived(votes.find(v => v.userId === $userStore.user?.uid));
	const voteCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const v of votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
		return counts;
	});

	// ── Comments state ──
	let comments = $state<CommentDoc[]>([]);
	let showCommentsThread = $state(false);
	$effect(() => { showCommentsThread = expandComments; });
	const latestComment = $derived(comments.length > 0 ? comments[0] : null);

	// ── Recipe collapsible state ──
	let ingredientsOpen = $state(false);
	let instructionsOpen = $state(false);

	$effect(() => {
		if (item.id) {
			return subscribeToComments(boardId, item.id, (v) => {
				comments = [...v].sort((a, b) => {
					const ta = a.createdAt?.toMillis?.() ?? 0;
					const tb = b.createdAt?.toMillis?.() ?? 0;
					return tb - ta;
				});
			});
		}
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

	// ── Photo swipe handlers ──
	const PHOTO_SWIPE_THRESHOLD = 40;

	function onPhotoPointerDown(e: PointerEvent) {
		photoPointerDown = true;
		photoSwiping = false;
		photoStartX = e.clientX;
		photoStartY = e.clientY;
		photoDragX = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPhotoPointerMove(e: PointerEvent) {
		if (!photoPointerDown) return;
		const dx = e.clientX - photoStartX;
		const dy = e.clientY - photoStartY;

		if (!photoSwiping && Math.abs(dx) > 6) {
			if (Math.abs(dx) / (Math.abs(dy) + 0.1) > 1.2) {
				photoSwiping = true;
			} else {
				photoPointerDown = false;
				photoDragX = 0;
				return;
			}
		}

		if (photoSwiping) {
			e.preventDefault();
			const allImgs = (item as PhotoContentDoc).images?.length > 0
				? (item as PhotoContentDoc).images : [{ url: (item as PhotoContentDoc).imageUrl }];
			const atStart = currentPhotoIdx === 0 && dx > 0;
			const atEnd = currentPhotoIdx === allImgs.length - 1 && dx < 0;
			photoDragX = (atStart || atEnd) ? dx * 0.2 : dx;
		}
	}

	function onPhotoPointerUp() {
		if (!photoPointerDown) return;
		photoPointerDown = false;

		if (photoSwiping && Math.abs(photoDragX) > PHOTO_SWIPE_THRESHOLD) {
			const allImgs = (item as PhotoContentDoc).images?.length > 0
				? (item as PhotoContentDoc).images : [{ url: (item as PhotoContentDoc).imageUrl }];
			if (photoDragX < 0 && currentPhotoIdx < allImgs.length - 1) currentPhotoIdx++;
			else if (photoDragX > 0 && currentPhotoIdx > 0) currentPhotoIdx--;
		}
		photoDragX = 0;
		photoSwiping = false;
	}

	function goToPhoto(idx: number) {
		currentPhotoIdx = idx;
	}

	function toggleVideo() {
		if (!videoEl) return;
		if (videoPlaying) videoEl.pause(); else videoEl.play();
		videoPlaying = !videoPlaying;
	}

	// ── Link helpers ──
	function getLinkIcon(url: string, enrichment: any): string {
		if (extractYouTubeId(url)) return 'ph:youtube-logo';
		if (enrichment) {
			if (isRecipeEnrichment(enrichment)) return 'ph:chef-hat';
			if (isMovieEnrichment(enrichment)) return 'ph:film-strip';
			if (isBookEnrichment(enrichment)) return 'ph:book';
			if (isPlaceEnrichment(enrichment)) return 'ph:map-pin';
			if (isMusicEnrichment(enrichment)) return 'ph:music-note';
			if (isArticleEnrichment(enrichment)) return 'ph:newspaper';
			if (isGithubEnrichment(enrichment)) return 'ph:github-logo';
		}
		return 'ph:link';
	}

	let showActions = $state(false);

	// Snippet for compact link metadata
</script>

{#snippet linkMetaSnippet(link: LinkContentDoc)}
	{#if link.enrichment}
		{@const e = link.enrichment}
		<div class="flex flex-wrap items-center gap-2 py-0.5 min-w-0">
			{#if isRecipeEnrichment(e)}
				{#if e.totalTime}<span class="px-2 py-0.5 rounded-lg bg-amber-500/10 text-[10px] font-bold text-amber-700 whitespace-nowrap">{e.totalTime}</span>{/if}
				{#if e.servings}<span class="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-[10px] font-bold text-emerald-700 whitespace-nowrap">{e.servings} Ser.</span>{/if}
				{#if e.calories}<span class="px-2 py-0.5 rounded-lg bg-red-500/10 text-[10px] font-bold text-red-700 whitespace-nowrap">{e.calories}</span>{/if}
				{#if e.cuisine}<span class="px-2 py-0.5 rounded-lg bg-violet-500/10 text-[10px] font-bold text-violet-700 whitespace-nowrap">{e.cuisine}</span>{/if}
			{:else if isMovieEnrichment(e)}
				{#if e.rating}<span class="px-2 py-0.5 rounded-lg bg-amber-500/10 text-[10px] font-bold text-amber-700 flex items-center gap-0.5 whitespace-nowrap"><Icon icon="ph:star-fill" class="text-[8px]" />{e.rating}</span>{/if}
				{#if e.year}<span class="text-[11px] text-muted font-medium whitespace-nowrap">{e.year}</span>{/if}
			{:else if isBookEnrichment(e)}
				{#if e.author}<span class="text-[11px] text-primary font-bold truncate max-w-[80px] whitespace-nowrap">{e.author}</span>{/if}
				{#if e.averageRating}<span class="px-2 py-0.5 rounded-lg bg-amber-500/10 text-[10px] font-bold text-amber-700 flex items-center gap-0.5 whitespace-nowrap"><Icon icon="ph:star-fill" class="text-[8px]" />{e.averageRating}</span>{/if}
			{:else if isPlaceEnrichment(e)}
				{#if e.category}<span class="text-[11px] text-primary font-bold truncate max-w-[80px] whitespace-nowrap">{e.category}</span>{/if}
				{#if e.rating}<span class="px-2 py-0.5 rounded-lg bg-amber-500/10 text-[10px] font-bold text-amber-700 flex items-center gap-0.5 whitespace-nowrap"><Icon icon="ph:star-fill" class="text-[8px]" />{e.rating}</span>{/if}
			{:else if isMusicEnrichment(e)}
				{#if e.artist}<span class="text-[11px] text-primary font-bold truncate max-w-[100px] whitespace-nowrap">{e.artist}</span>{/if}
				{#if e.album}<span class="text-[11px] text-muted truncate max-w-[80px] whitespace-nowrap">{e.album}</span>{/if}
			{:else if isGithubEnrichment(e)}
				{#if e.language}<span class="text-[11px] text-primary font-bold whitespace-nowrap">{e.language}</span>{/if}
				{#if e.stars}<span class="text-[11px] font-bold flex items-center gap-0.5 whitespace-nowrap"><Icon icon="ph:star-fill" class="text-amber-500 text-[10px]" />{e.stars}</span>{/if}
			{:else if isArticleEnrichment(e)}
				{#if e.siteName}<span class="text-[11px] text-primary font-bold truncate max-w-[100px] whitespace-nowrap">{e.siteName}</span>{/if}
				{#if e.readingTime}<span class="text-[11px] text-muted font-medium whitespace-nowrap">{e.readingTime}</span>{/if}
			{:else if isVideoEnrichment(e)}
				{#if e.author}
					<span class="text-[13px] text-on-surface font-bold truncate max-w-[200px] whitespace-nowrap">
						{e.author}
					</span>
				{/if}
				{#if e.publishedDate}
					<span class="text-[11px] text-muted whitespace-nowrap">· {e.publishedDate}</span>
				{:else if e.siteName && e.siteName !== e.author}
					<span class="text-[11px] text-muted whitespace-nowrap">· {e.siteName}</span>
				{/if}
			{/if}
		</div>
	{/if}
{/snippet}

<Popup opened={!!item} onBackdropClick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex flex-col h-full bg-surface"
		style="transform: {swipeTransform}; opacity: {swipeOpacity}; transition: {swipeDeltaX === 0 ? 'transform 0.3s ease, opacity 0.3s ease' : 'none'};"
		ontouchstart={onModalTouchStart}
		ontouchmove={onModalTouchMove}
		ontouchend={onModalTouchEnd}
		ontouchcancel={onModalTouchCancel}
		role="dialog"
		aria-label="Card detail modal"
		tabindex="-1"
	>
		<!-- Floating close button -->
		<button
			onclick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}
			class="absolute left-3 z-[100] w-9 h-9 rounded-full bg-black/40 backdrop-blur-md
				flex items-center justify-center text-white shadow-lg press-scale"
			style="top: calc(env(safe-area-inset-top, 0px) + 0.75rem);"
			aria-label="Close"
		>
			<Icon icon="ph:caret-left-bold" class="text-base" />
		</button>

		{#if onDelete}
			<button
				onclick={() => { showActions = true; hapticLight(); }}
				class="absolute right-3 z-[100] w-9 h-9 rounded-full bg-black/40 backdrop-blur-md
					flex items-center justify-center text-white shadow-lg press-scale"
				style="top: calc(env(safe-area-inset-top, 0px) + 0.75rem);"
				aria-label="More actions"
			>
				<Icon icon="ph:dots-three-bold" class="text-lg" />
			</button>
		{/if}

		<!-- ─── Media Area (Sticky) ─── -->
		{#if item.type !== 'poll' && item.type !== 'list'}
		<div class="shrink-0 z-20 bg-black relative" style="padding-top: env(safe-area-inset-top, 0px);">

			{#if item.type === 'photo'}
				{@const photo = item as PhotoContentDoc}
				{@const allImages = photo.images?.length > 0 ? photo.images : [{ url: photo.imageUrl, width: photo.width, height: photo.height }]}
				{@const isMulti = allImages.length > 1}

				<div
					class="relative overflow-hidden select-none touch-pan-y min-h-[300px] flex items-center justify-center bg-black"
					data-no-swipe
					onpointerdown={isMulti ? onPhotoPointerDown : undefined}
					onpointermove={isMulti ? onPhotoPointerMove : undefined}
					onpointerup={isMulti ? onPhotoPointerUp : undefined}
					onpointercancel={isMulti ? onPhotoPointerUp : undefined}
				>
					{#if !photoError}
						<img
							src={allImages[currentPhotoIdx]?.url || photo.imageUrl}
							alt={photo.caption || 'Photo'}
							class="max-w-full max-h-[70vh] object-contain transition-transform duration-200 ease-out"
							style={photoSwiping ? `transform: translateX(${photoDragX}px); transition: none;` : ''}
							loading="lazy"
							draggable="false"
							onerror={() => { photoError = true; }}
						/>

					{:else}
						<div class="flex items-center justify-center aspect-video text-muted">
							<Icon icon="ph:image-broken" class="text-4xl" />
						</div>
					{/if}

					{#if isMulti}
						<!-- Counter pill -->
						<div class="absolute top-14 right-3 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md z-10">
							<span class="text-[10px] text-white font-semibold tabular-nums">{currentPhotoIdx + 1}/{allImages.length}</span>
						</div>

						<!-- Navigation Carets -->
						{#if currentPhotoIdx > 0}
							<button onclick={(e) => { e.stopPropagation(); goToPhoto(currentPhotoIdx - 1); }}
								class="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md text-white
									flex items-center justify-center press-scale z-10 transition-opacity"
								aria-label="Previous photo">
								<Icon icon="ph:caret-left-bold" class="text-base" />
							</button>
						{/if}
						{#if currentPhotoIdx < allImages.length - 1}
							<button onclick={(e) => { e.stopPropagation(); goToPhoto(currentPhotoIdx + 1); }}
								class="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md text-white
									flex items-center justify-center press-scale z-10 transition-opacity"
								aria-label="Next photo">
								<Icon icon="ph:caret-right-bold" class="text-base" />
							</button>
						{/if}
					{/if}
				</div>

			{:else if item.type === 'video'}
				{@const video = item as VideoContentDoc}
				<div class="relative aspect-video" data-no-swipe>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						src={video.videoUrl}
						poster={video.thumbnailUrl}
						class="w-full h-full object-contain"
						onplay={() => { videoPlaying = true; }}
						onpause={() => { videoPlaying = false; }}
						onended={() => { videoPlaying = false; }}
						controls={videoPlaying}
					></video>
					{#if !videoPlaying}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer" onclick={toggleVideo}>
							<div class="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center press-scale ring-1 ring-white/20">
								<Icon icon="ph:play-fill" class="text-2xl text-white ml-1" />
							</div>
						</div>
					{/if}
				</div>

			{:else if item.type === 'link'}
				{@const link = item as LinkContentDoc}
				{@const youtubeId = extractYouTubeId(link.url)}
				{#if youtubeId}
					<div class="aspect-video relative" data-no-swipe>
						<iframe
							src="https://www.youtube.com/embed/{youtubeId}?autoplay=0&mute=1&playsinline=1&rel=0"
							title={link.title}
							class="w-full h-full"
							frameborder="0"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
							allowfullscreen
						></iframe>
					</div>
				{:else if link.image}
					<div class="{isMovieEnrichment(link.enrichment) ? 'h-[60vh]' : 'aspect-video'} relative overflow-hidden bg-surface-1">
						<img src={link.image} alt="" class="w-full h-full {isBookEnrichment(link.enrichment) ? 'object-contain p-4' : 'object-cover'}" />
						<div class="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-md">
							<div class="w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
								<Icon icon={getLinkIcon(link.url, link.enrichment)} class="text-[10px] text-white" />
							</div>
							<span class="text-[10px] text-white font-semibold">{link.domain}</span>
						</div>
					</div>
				{:else}
					<!-- Placeholder for link without image -->
					<div class="{isMovieEnrichment(link.enrichment) ? 'h-[60vh]' : 'aspect-video'} flex items-center justify-center bg-surface-1 text-muted">
						<Icon icon={getLinkIcon(link.url, link.enrichment)} class="text-5xl opacity-20" />
					</div>
				{/if}
			
			{:else if item.type === 'product'}
				{@const product = item as ProductContentDoc}
				{#if product.image}
					<div class="aspect-video relative overflow-hidden bg-surface-1">
						<img src={product.image} alt="" class="w-full h-full object-cover" />
						{#if product.domain}
							<div class="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-md">
								<Icon icon="ph:storefront" class="text-[10px] text-white" />
								<span class="text-[10px] text-white font-semibold">{product.domain}</span>
							</div>
						{/if}
					</div>
				{:else}
					<div class="aspect-video flex items-center justify-center bg-surface-1 text-muted">
						<Icon icon="ph:shopping-bag" class="text-5xl opacity-20" />
					</div>
				{/if}

			{:else if item.type === 'voice'}
				<div class="h-32 bg-primary/5 flex items-center justify-center">
					<div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:microphone" class="text-3xl text-primary" />
					</div>
				</div>

			{:else if item.type === 'location'}
				{@const loc = item as LocationContentDoc}
				<div class="relative">
					<MapView
						latitude={loc.latitude}
						longitude={loc.longitude}
						zoom={14}
						interactive={false}
						height="220px"
						class="!rounded-none"
					/>
					{#if loc.name}
						<div class="absolute bottom-3 left-3 right-3 flex items-center gap-1.5">
							<div class="w-6 h-6 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shrink-0 shadow-sm">
								<Icon icon="ph:map-pin-fill" class="text-sm text-primary" />
							</div>
							<span class="text-[13px] text-white font-semibold truncate drop-shadow-md">{loc.name}</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		{/if}

		<!-- ─── Content Area (Scrollable) ─── -->
		<div class="flex-1 overflow-y-auto">
			<div
				class="px-5 pb-20"
				style="padding-top: {item.type === 'poll' || item.type === 'list' || item.type === 'note'
					? 'calc(env(safe-area-inset-top, 0px) + 4rem)'
					: '1rem'};"
			>
				<!-- Title -->
				{#if item.type !== 'note'}
				<h1 class="text-[19px] font-bold text-on-surface leading-tight">
					{#if item.type === 'link'}
						{(item as LinkContentDoc).title}
					{:else if item.type === 'product'}
						{(item as ProductContentDoc).title}
					{:else if item.type === 'list'}
						{(item as ListContentDoc).title}
					{:else if item.type === 'poll'}
						{(item as PollContentDoc).question}
					{:else if item.type === 'location'}
						{(item as LocationContentDoc).name || 'Location'}
					{:else if item.type === 'photo'}
						{(item as PhotoContentDoc).caption || 'Photo'}
					{:else if item.type === 'video'}
						{(item as VideoContentDoc).caption || 'Video'}
					{:else if item.type === 'voice'}
						Voice Memo
					{/if}
				</h1>
				{/if}

				<!-- Link description sits directly under the title for every
				     variant so the OG/meta summary is the first thing readers
				     see. Articles and recipes are the exception — their long-form
				     body (contentHtml / description / steps) renders below the
				     comments in Content Body. -->
				{#if item.type === 'link'}
					{@const link = item as LinkContentDoc}
					{@const isLongForm = link.enrichment && (isArticleEnrichment(link.enrichment) || isRecipeEnrichment(link.enrichment))}
					{#if link.description && !isLongForm}
						<p class="text-[14px] text-on-surface/75 leading-relaxed mt-2">{link.description}</p>
					{/if}
				{/if}

				<!-- Poll / List / Voice content (between title and comments) -->
				{#if item.type === 'poll'}
					{@const poll = item as PollContentDoc}
					<div class="flex flex-col gap-2 mt-3 mb-4">
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
									<span class="text-[12px] text-muted font-bold tabular-nums">{Math.round(percent)}%</span>
								</div>
							</button>
						{/each}
						<p class="text-[11px] text-muted text-center mt-1">{totalVotes} votes</p>
					</div>
				{:else if item.type === 'list'}
					{@const list = item as ListContentDoc}
					{@const completedCount = list.items.filter(i => i.completed).length}
					{@const totalCount = list.items.length}
					{@const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0}

					<div class="mt-3 mb-4">
						<div class="flex items-center justify-between mb-2">
							<span class="text-[13px] font-bold text-muted uppercase tracking-wider">Progress</span>
							<span class="text-[13px] font-bold text-primary">{completedCount}/{totalCount}</span>
						</div>
						<Progressbar progress={progress} />
					</div>

					<div class="space-y-1 mt-3">
						{#each list.items as listItem (listItem.id)}
							<div class="flex items-center gap-3 p-2 rounded-xl {listItem.completed ? 'opacity-50' : ''}">
								<Checkbox
									checked={listItem.completed}
									onchange={() => onToggleListItem?.(item as ListContentDoc, listItem.id)}
								/>
								<span class="text-[15px] {listItem.completed ? 'line-through' : ''}">{listItem.text}</span>
							</div>
						{/each}
					</div>
				{:else if item.type === 'voice'}
					{@const voice = item as VoiceContentDoc}
					<div class="mt-3 mb-4">
						<div class="bg-surface-1 rounded-2xl p-4 flex flex-col gap-3">
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div class="relative h-12 flex items-center px-2 cursor-pointer" onclick={seekVoice} bind:clientWidth={voiceWaveformWidth}>
								<div class="absolute inset-0 bg-primary/5 rounded-lg"></div>
								<div class="flex items-end gap-[2px] flex-1 h-full py-2">
									{#each voiceBarHeights as h, i}
										<div class="flex-1 rounded-full transition-colors {i / voiceBarHeights.length < voiceProgress / 100 ? 'bg-primary' : 'bg-primary/20'}" style="height: {h}px;"></div>
									{/each}
								</div>
							</div>
							<div class="flex items-center justify-between px-1">
								<span class="text-[11px] font-bold text-muted tabular-nums">{formatTime(currentTime)}</span>
								<button onclick={toggleVoice} aria-label={voicePlaying ? 'Pause voice note' : 'Play voice note'} class="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center press-scale shadow-lg shadow-primary/20">
									<Icon icon={voicePlaying ? 'ph:pause-fill' : 'ph:play-fill'} class="text-xl" />
								</button>
								<span class="text-[11px] font-bold text-muted tabular-nums">{formatTime(duration)}</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Location address row -->
				{#if item.type === 'location'}
					{@const loc = item as LocationContentDoc}
					{#if loc.address}
						<div class="mt-2 flex items-start gap-2">
							<Icon icon="ph:map-pin" class="text-base text-primary shrink-0 mt-0.5" />
							<p class="text-[13px] text-muted leading-snug line-clamp-2">{loc.address}</p>
						</div>
					{/if}
				{/if}

				<!-- Link Meta Row -->
				{#if item.type === 'link' || item.type === 'video'}
					<div class="mt-2.5 min-w-0">
						{#if (item as any).enrichment}
							{@render linkMetaSnippet(item as LinkContentDoc)}
						{/if}

						{#if item.type === 'link' && !(item as LinkContentDoc).enrichment && extractYouTubeId((item as LinkContentDoc).url)}
							<div class="flex items-center gap-2 py-0.5">
								<span class="text-[11px] text-primary font-bold whitespace-nowrap">YouTube</span>
							</div>
						{:else if item.type === 'video' && (item as VideoContentDoc).durationMs && !(item as any).enrichment}
							<div class="flex items-center gap-2 py-0.5">
								<span class="px-2 py-0.5 rounded-lg bg-surface-2 text-[10px] font-bold text-muted whitespace-nowrap">
									{formatDurationMs((item as VideoContentDoc).durationMs)}
								</span>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Link short-form content (above comments) -->
				{#if item.type === 'link'}
					{@const link = item as LinkContentDoc}
					{#if link.enrichment && isVideoEnrichment(link.enrichment)}
						<!-- video enrichment: description already shown above title -->
					{:else if link.enrichment && isMovieEnrichment(link.enrichment)}
						{@const movie = link.enrichment}
						<div class="space-y-2 mt-3">
							{#if movie.director}
								<p class="text-sm"><span class="font-bold text-muted uppercase text-[10px] tracking-wider mr-2">Director</span> {movie.director}</p>
							{/if}
							{#if movie.cast?.length > 0}
								<p class="text-sm leading-relaxed"><span class="font-bold text-muted uppercase text-[10px] tracking-wider mr-2">Cast</span> {movie.cast.slice(0, 6).join(', ')}</p>
							{/if}
						</div>
					{:else if link.enrichment && isBookEnrichment(link.enrichment)}
						{@const book = link.enrichment}
						{#if book.publisher}
							<p class="text-xs text-muted mt-2">Published by {book.publisher} {book.publishDate ? `· ${book.publishDate}` : ''}</p>
						{/if}
					{:else if link.enrichment && isPlaceEnrichment(link.enrichment)}
						{@const place = link.enrichment}
						<div class="space-y-3 mt-3">
							{#if place.address}
								<div class="flex gap-3 items-start text-sm">
									<Icon icon="ph:map-pin" class="text-lg text-muted shrink-0" />
									<span>{place.address}</span>
								</div>
							{/if}
							{#if place.phone}
								<div class="flex gap-3 items-center text-sm">
									<Icon icon="ph:phone" class="text-lg text-muted shrink-0" />
									<a href="tel:{place.phone}" class="text-primary">{place.phone}</a>
								</div>
							{/if}
							{#if place.hours}
								<div class="flex gap-3 items-start text-sm">
									<Icon icon="ph:clock" class="text-lg text-muted shrink-0" />
									<span class="text-on-surface/70">{place.hours}</span>
								</div>
							{/if}
						</div>
						{#if place.latitude && place.longitude}
							<a href="https://www.google.com/maps?q={place.latitude},{place.longitude}" target="_blank" rel="noopener noreferrer" class="mt-4 block">
								<Button large rounded class="w-full">
									<Icon icon="ph:navigation-arrow" class="mr-2" />
									Open in Maps
								</Button>
							</a>
						{/if}
					{:else if link.enrichment && isMusicEnrichment(link.enrichment)}
						<a href={link.url} target="_blank" rel="noopener noreferrer" class="mt-4 block">
							<Button large rounded class="w-full">
								<Icon icon="ph:play-circle" class="mr-2 text-xl" />
								Listen on {link.domain}
							</Button>
						</a>
					{:else if link.enrichment && isGithubEnrichment(link.enrichment)}
						<a href={link.url} target="_blank" rel="noopener noreferrer" class="mt-4 block">
							<Button large rounded class="w-full">
								<Icon icon="ph:github-logo" class="mr-2" />
								View Repository
							</Button>
						</a>
					{/if}
				{:else if item.type === 'note'}
					{@const note = item as NoteContentDoc}
					{@const noteText = note.text.trim()}
					{@const isNoteShort = noteText.length <= 80 && !noteText.includes('\n')}
					{#if isNoteShort}
						<div class="text-center py-6 px-4 relative mt-3">
							<span class="absolute left-2 top-2 text-5xl text-primary/20 font-serif leading-none select-none">"</span>
							<p class="text-3xl font-medium text-on-surface leading-snug px-6">{noteText}</p>
							<span class="absolute right-2 bottom-2 text-5xl text-primary/20 font-serif leading-none select-none">"</span>
						</div>
					{:else}
						{@const noteTextSize = (() => {
							const len = noteText.length;
							if (len <= 40) return 'text-2xl';
							if (len <= 80) return 'text-xl';
							if (len <= 150) return 'text-lg';
							if (len <= 300) return 'text-[15px]';
							return 'text-[14px]';
						})()}
						<p class="{noteTextSize} leading-relaxed text-on-surface/90 whitespace-pre-wrap font-[350] mt-3">{noteText}</p>
					{/if}
				{/if}

				<!-- Interaction Row -->
				<div class="flex items-center justify-between mt-4 gap-3">
					<!-- Left: Author -->
					<div class="flex items-center gap-2.5 shrink-0">
						{#if resolvedAuthorPhoto && !authorImageError}
							<img src={resolvedAuthorPhoto} alt="" class="w-9 h-9 rounded-full object-cover" onerror={() => { authorImageError = true; }} />
						{:else}
							<div class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-bold">
								{avatarInitial(item.authorName)}
							</div>
						{/if}
						<div class="flex flex-col">
							<span class="text-[14px] font-bold text-on-surface">{item.authorName}</span>
							<span class="text-[11px] text-muted">{relativeTime(createdAt)}</span>
						</div>
					</div>

					<!-- Right: Pills -->
					<div class="flex items-center gap-2 shrink-0">
						<!-- Like/Ack Pill -->
						<div class="bg-surface-1 rounded-full px-3 py-1.5 flex items-center gap-1.5 ring-1 ring-border/20">
							<CardAcknowledgmentButton {boardId} contentId={item.id} acknowledgments={item.acknowledgments} isDetail={true} />
						</div>

						<!-- Share Pill -->
						<button
							onclick={(e) => { e.stopPropagation(); hapticLight(); onShare?.(item); }}
							class="bg-surface-1 rounded-full px-3 py-1.5 flex items-center gap-1.5 ring-1 ring-border/20 active:bg-surface-2 transition-colors"
							aria-label="Share"
						>
							<Icon icon="ph:share-fat" class="text-base text-on-surface/70" />
						</button>

						<!-- Open Link (only for link type) -->
						{#if item.type === 'link'}
							<a href={(item as LinkContentDoc).url} target="_blank" rel="noopener noreferrer"
								class="bg-surface-1 rounded-full px-3 py-1.5 flex items-center gap-1.5 ring-1 ring-border/20 active:bg-surface-2 transition-colors"
								aria-label="Open link in new tab"
							>
								<Icon icon="ph:arrow-square-out" class="text-base text-on-surface/70" />
							</a>
						{/if}
					</div>
				</div>

				<!-- Comment Preview Card -->
				{#if allowComments}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div 
						class="mt-4 bg-surface-1 rounded-2xl p-4 border border-border/10 cursor-pointer active:bg-surface-2 transition-colors"
						onclick={() => { showCommentsThread = true; hapticLight(); }}
					>
						<div class="flex items-center justify-between mb-3">
							<div class="flex items-center gap-1.5">
								<span class="text-[13px] font-bold text-on-surface">Comments</span>
								<span class="text-[12px] text-muted font-medium tabular-nums">{comments.length}</span>
							</div>
							<Icon icon="ph:caret-right-bold" class="text-xs text-muted" />
						</div>

						{#if latestComment}
							<div class="flex gap-2.5 items-start">
								{#if latestComment.authorPhotoURL && !commentImageError}
									<img src={latestComment.authorPhotoURL} alt="" class="w-6 h-6 rounded-full object-cover shrink-0" onerror={() => { commentImageError = true; }} />
								{:else}
									<div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold shrink-0">
										{avatarInitial(latestComment.authorName)}
									</div>
								{/if}
								
								{#if latestComment.text}
									<p class="text-[13px] text-on-surface leading-tight line-clamp-2 flex-1 min-w-0">
										{latestComment.text}
									</p>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2 text-muted/50 py-1">
								<Icon icon="ph:chat-circle-dots" class="text-lg" />
								<span class="text-[13px]">Add a comment...</span>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Content Body (long-form content only: recipe, article) -->
				<div class="mt-5">
					{#if item.type === 'link'}
						{@const link = item as LinkContentDoc}
						{#if link.enrichment && isRecipeEnrichment(link.enrichment)}
							{@const recipe = link.enrichment}

							<!-- Recipe metadata pills -->
							<div class="flex flex-wrap items-center gap-1.5 mb-4">
								{#if recipe.totalTime}
									<MetadataPill icon="ph:timer" text={recipe.totalTime} variant="surface" />
								{/if}
								{#if recipe.servings}
									<MetadataPill icon="ph:users" text={recipe.servings} variant="surface" />
								{/if}
								{#if recipe.calories}
									<MetadataPill icon="ph:fire" text={recipe.calories} variant="surface" />
								{/if}
								{#if recipe.cuisine}
									<MetadataPill text={recipe.cuisine} variant="surface" />
								{/if}
								{#if recipe.ingredients.length > 0}
									<span class="px-2 py-0.5 rounded-lg bg-surface-1 text-[10px] font-bold text-muted flex items-center gap-1 whitespace-nowrap">
										<Icon icon="ph:list-bullets" class="text-[10px]" />{recipe.ingredients.length} ingredients
									</span>
								{/if}
							</div>

							{#if recipe.ingredients.length > 0}
								<button onclick={() => ingredientsOpen = !ingredientsOpen} class="flex items-center justify-between w-full mb-2">
									<h3 class="text-[15px] font-bold">Ingredients</h3>
									<Icon icon={ingredientsOpen ? 'ph:caret-up' : 'ph:caret-down'} class="text-base text-muted" />
								</button>
								{#if ingredientsOpen}
									<ul class="space-y-1.5 mb-4">
										{#each recipe.ingredients as ing}
											<li class="text-[14px] text-on-surface/80 flex items-start gap-2">
												<span class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0"></span>
												{ing}
											</li>
										{/each}
									</ul>
								{/if}
							{/if}
							{#if recipe.instructions.length > 0}
								<button onclick={() => instructionsOpen = !instructionsOpen} class="flex items-center justify-between w-full mb-2">
									<h3 class="text-[15px] font-bold">Instructions</h3>
									<Icon icon={instructionsOpen ? 'ph:caret-up' : 'ph:caret-down'} class="text-base text-muted" />
								</button>
								{#if instructionsOpen}
									<ol class="space-y-3 mb-4">
										{#each recipe.instructions as step, i}
											<li class="flex gap-3">
												<span class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
													<span class="text-[11px] font-bold text-primary">{i + 1}</span>
												</span>
												<p class="text-[14px] text-on-surface/80 leading-relaxed flex-1">{step}</p>
											</li>
										{/each}
									</ol>
								{/if}
							{/if}
						{:else if link.enrichment && isArticleEnrichment(link.enrichment)}
							{@const article = link.enrichment}
							{#if article.contentHtml}
								<div class="article-content text-[16px] leading-relaxed">
									{@html article.contentHtml}
								</div>
							{:else if link.description}
								<p class="text-[15px] text-on-surface/80 leading-relaxed mb-4">{link.description}</p>
							{/if}
						{/if}

					{:else if item.type === 'product'}
						{@const product = item as ProductContentDoc}
						{#if product.price && product.price.trim()}
							<div class="bg-surface-1 rounded-2xl p-4 mb-4 border border-border/20">
								<div class="flex items-baseline gap-2 mb-1">
									<span class="text-2xl font-bold text-emerald-600">{product.price}</span>
									{#if product.originalPrice && product.originalPrice !== product.price}
										<span class="text-sm text-muted line-through">{product.originalPrice}</span>
									{/if}
								</div>
								<p class="text-[13px] text-muted">{product.domain}</p>
							</div>
						{/if}
						{#if product.enrichment}
							{@const e = product.enrichment}
							{#if isProductEnrichment(e)}
								<div class="flex flex-wrap items-center gap-1.5 mb-4">
									{#if e.brand}<MetadataPill icon="ph:storefront" text={e.brand} variant="surface" />{/if}
									{#if e.rating}
										<MetadataPill
											icon="ph:star-fill"
											text={e.ratingCount ? `${e.rating} (${e.ratingCount})` : String(e.rating)}
											variant="rating"
										/>
									{/if}
									{#if e.availability === 'OutOfStock'}
										<MetadataPill icon="ph:x-circle" text="Out of stock" variant="surface" />
									{:else if e.availability === 'PreOrder'}
										<MetadataPill icon="ph:clock" text="Pre-order" variant="surface" />
									{:else if e.availability === 'BackOrder'}
										<MetadataPill icon="ph:clock-countdown" text="Backorder" variant="surface" />
									{:else if e.availability === 'LimitedAvailability'}
										<MetadataPill icon="ph:warning" text="Limited" variant="surface" />
									{:else if e.availability === 'Discontinued'}
										<MetadataPill icon="ph:prohibit" text="Discontinued" variant="surface" />
									{/if}
									{#if e.category}<MetadataPill text={e.category} variant="surface" />{/if}
								</div>
							{:else if isRecipeEnrichment(e)}
								<div class="flex flex-wrap items-center gap-1.5 mb-4">
									{#if e.totalTime}<MetadataPill icon="ph:timer" text={e.totalTime} variant="surface" />{/if}
									{#if e.servings}<MetadataPill icon="ph:users" text={e.servings} variant="surface" />{/if}
									{#if e.calories}<MetadataPill icon="ph:fire" text={e.calories} variant="surface" />{/if}
									{#if e.cuisine}<MetadataPill text={e.cuisine} variant="surface" />{/if}
								</div>
							{:else if isMovieEnrichment(e)}
								<div class="flex flex-wrap items-center gap-1.5 mb-4">
									{#if e.rating}<MetadataPill icon="ph:star-fill" text={String(e.rating)} variant="rating" />{/if}
									{#if e.year}<MetadataPill text={String(e.year)} variant="surface" />{/if}
									{#if e.runtime}<MetadataPill text={e.runtime} variant="surface" />{/if}
								</div>
							{/if}
						{/if}
						<a href={product.url} target="_blank" rel="noopener noreferrer">
							<Button large rounded class="w-full">
								<Icon icon="ph:shopping-bag" class="mr-2" />
								View Product
							</Button>
						</a>

					{:else if item.type === 'location'}
						{@const loc = item as LocationContentDoc}
						<a href="https://www.google.com/maps?q={loc.latitude},{loc.longitude}" target="_blank" rel="noopener noreferrer" class="block mt-3">
							<Button large rounded class="w-full">
								<Icon icon="ph:navigation-arrow" class="mr-2" />
								Navigate to Place
							</Button>
						</a>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Full Comment Thread (YouTube style) -->
	<Popup opened={showCommentsThread} onBackdropClick={() => (showCommentsThread = false)}>
		<Page class="bg-surface">
			<div class="flex flex-col h-full">
				<div class="px-5 py-4 pt-safe border-b border-surface-1 flex items-center justify-between sticky top-0 bg-surface z-10">
					<div class="flex items-center gap-2">
						<span class="text-[16px] font-bold">Comments</span>
						<span class="text-[14px] text-muted font-medium tabular-nums">{comments.length}</span>
					</div>
					<button
						onclick={() => (showCommentsThread = false)}
						aria-label="Close comments"
						class="w-8 h-8 rounded-full bg-surface-1 flex items-center justify-center text-muted"
					>
						<Icon icon="ph:x-bold" class="text-sm" />
					</button>
				</div>
				<div class="flex-1 overflow-y-auto px-5 pt-4 pb-12 pb-safe">
					<CardComments {boardId} contentId={item.id} {isBoardOwner} {allowComments} />
				</div>
			</div>
		</Page>
	</Popup>

	<!-- Action Sheet for Delete Card -->
	<div class="relative z-50">
	<Actions opened={showActions} onBackdropClick={() => (showActions = false)}>
		<ActionsGroup>
			<ActionsButton
				class="!text-error"
				onClick={() => { showActions = false; onDelete?.(item); }}
			>
				Delete Card
			</ActionsButton>
		</ActionsGroup>
		<ActionsGroup>
			<ActionsButton onClick={() => (showActions = false)} bold>
				Cancel
			</ActionsButton>
		</ActionsGroup>
	</Actions>
	</div>
</Popup>

<style>
	:global(.article-content) {
		color: var(--color-on-surface);
	}
	:global(.article-content p) {
		margin-bottom: 1.25rem;
	}
	:global(.article-content h1, .article-content h2, .article-content h3) {
		font-weight: 700;
		line-height: 1.3;
		margin-top: 2rem;
		margin-bottom: 0.75rem;
		color: var(--color-on-surface);
	}
	:global(.article-content h1) { font-size: 1.5rem; }
	:global(.article-content h2) { font-size: 1.25rem; }
	:global(.article-content h3) { font-size: 1.1rem; }
	
	:global(.article-content ul, .article-content ol) {
		margin-bottom: 1.25rem;
		padding-left: 1.25rem;
	}
	:global(.article-content li) {
		margin-bottom: 0.5rem;
	}
	:global(.article-content ul) { list-style-type: disc; }
	:global(.article-content ol) { list-style-type: decimal; }
	
	:global(.article-content img) {
		max-width: 100%;
		height: auto;
		border-radius: 0.5rem;
		margin: 1.5rem 0;
	}
	
	:global(.article-content a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	
	:global(.article-content blockquote) {
		border-left: 3px solid var(--color-primary);
		padding-left: 1rem;
		font-style: italic;
		margin: 1.5rem 0;
		color: var(--color-on-surface-variant);
	}
</style>
