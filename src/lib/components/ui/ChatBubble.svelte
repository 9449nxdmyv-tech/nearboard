<!--
  @file ChatBubble.svelte
  @description Renders a single ContentDoc as a chat bubble.
               Text notes appear as plain chat bubbles (own = right, others = left).
               Rich content (links, photos, videos, etc.) shows as compact inline previews.
               Tapping a rich bubble opens the card detail modal.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import type { ContentDoc, CommentDoc } from '$lib/types';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { formatDurationMs } from '$lib/utils/dateFormatter';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import Avatar from './Avatar.svelte';
	import { userStore } from '$lib/stores';
	import { subscribeToComments } from '$lib/firebase/boardService';
	import { hapticLight } from '$lib/utils/haptics';

	let {
		item,
		onTap,
		onReply
	}: {
		item: ContentDoc;
		onTap?: (item: ContentDoc) => void;
		onReply?: (item: ContentDoc) => void;
	} = $props();

	const isOwn = $derived(item.authorId === $userStore.user?.uid);
	const time = $derived(relativeTime(item.createdAt?.toDate?.() ?? new Date()));
	const isRichContent = $derived(item.type !== 'note');

	// Subscribe to comments for all content (show 3 most recent)
	let comments = $state<CommentDoc[]>([]);
	const recentComments = $derived(comments.slice(-3));

	onMount(() => {
		return subscribeToComments(item.boardId, item.id, (c) => { comments = c; }, 3);
	});

	const bubbleBase = 'max-w-[85%] group';
	const ownBubbleColor = 'bg-accent text-white rounded-2xl rounded-br-md';
	const otherBubbleColor = 'bg-surface-1 text-on-surface rounded-2xl rounded-bl-md';

	function handleTap() {
		if (isRichContent) {
			onTap?.(item);
		}
	}

	function handleReply() {
		hapticLight();
		onReply?.(item);
	}
</script>

<div
	class="flex gap-2 {isOwn ? 'flex-row-reverse' : ''}"
	in:scale={{ start: 0.9, duration: 200, easing: backOut, opacity: 0 }}
>
	<!-- Avatar (other users only) -->
	{#if !isOwn}
		<div class="mt-0.5">
			<Avatar name={item.authorName} photoURL={item.authorPhotoURL} size="sm" />
		</div>
	{/if}

	<!-- Bubble content -->
	<div class={bubbleBase}>
		{#if !isOwn}
			<p class="text-[10px] font-semibold text-muted mb-0.5 px-1">{item.authorName}</p>
		{/if}

		{#if item.type === 'note'}
			<!-- Plain text bubble -->
			<div class="{isOwn ? ownBubbleColor : otherBubbleColor} px-3.5 py-2.5">
				<p class="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{item.text}</p>
			</div>

		{:else if item.type === 'photo'}
			<!-- Photo bubble -->
			<button onclick={handleTap} aria-label={item.caption ? `Open photo: ${item.caption}` : 'Open photo'} class="block rounded-2xl overflow-hidden {isOwn ? 'rounded-br-md' : 'rounded-bl-md'}">
				<img
					src={item.imageUrl}
					alt={item.caption ?? 'Photo'}
					class="max-w-[260px] max-h-[200px] object-cover"
					loading="lazy"
				/>
				{#if item.caption}
					<div class="{isOwn ? 'bg-accent/90 text-white' : 'bg-surface-1 text-on-surface'} px-3 py-1.5">
						<p class="text-[12px] leading-snug line-clamp-2">{item.caption}</p>
					</div>
				{/if}
			</button>

		{:else if item.type === 'video'}
			<!-- Video bubble -->
			<button onclick={handleTap} aria-label={item.caption ? `Open video: ${item.caption}` : 'Open video'} class="block rounded-2xl overflow-hidden {isOwn ? 'rounded-br-md' : 'rounded-bl-md'}">
				<div class="relative">
					{#if item.thumbnailUrl}
						<img src={item.thumbnailUrl} alt="Video" class="max-w-[260px] max-h-[180px] object-cover" loading="lazy" />
					{:else}
						<div class="w-[260px] h-[140px] bg-black/80 flex items-center justify-center">
							<Icon icon="ph:video-camera" class="text-2xl text-white/40" />
						</div>
					{/if}
					<div class="absolute inset-0 flex items-center justify-center">
						<div class="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
							<Icon icon="ph:play-fill" class="text-lg text-white ml-0.5" />
						</div>
					</div>
					<div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-black/50 text-[10px] text-white font-medium">
						{formatDurationMs(item.durationMs)}
					</div>
				</div>
				{#if item.caption}
					<div class="{isOwn ? 'bg-accent/90 text-white' : 'bg-surface-1 text-on-surface'} px-3 py-1.5">
						<p class="text-[12px] leading-snug line-clamp-2">{item.caption}</p>
					</div>
				{/if}
			</button>

		{:else if item.type === 'link'}
			<!-- Link bubble -->
			<button onclick={handleTap} class="block rounded-2xl overflow-hidden {isOwn ? 'rounded-br-md' : 'rounded-bl-md'} text-left">
				{#if item.image}
					<img src={item.image} alt="" class="max-w-[260px] max-h-[140px] w-full object-cover" loading="lazy" />
				{/if}
				<div class="{isOwn ? 'bg-accent/90 text-white' : 'bg-surface-1 text-on-surface'} px-3 py-2">
					<p class="text-[12px] font-semibold leading-snug line-clamp-2">{item.title}</p>
					<p class="text-[10px] {isOwn ? 'text-white/60' : 'text-muted'} mt-0.5 flex items-center gap-1">
						{#if item.favicon}
							<img src={item.favicon} alt="" class="w-3 h-3 rounded-sm" />
						{/if}
						{item.domain}
					</p>
				</div>
			</button>

		{:else if item.type === 'product'}
			<!-- Product bubble -->
			<button onclick={handleTap} class="block rounded-2xl overflow-hidden {isOwn ? 'rounded-br-md' : 'rounded-bl-md'} text-left">
				<div class="flex gap-2 {isOwn ? 'bg-accent/90 text-white' : 'bg-surface-1 text-on-surface'} p-2.5">
					{#if item.image}
						<img src={item.image} alt="" class="w-14 h-14 rounded-lg object-cover shrink-0" loading="lazy" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-[12px] font-semibold leading-snug line-clamp-2">{item.title}</p>
						<p class="text-[13px] font-bold mt-0.5">{item.price}</p>
						<p class="text-[10px] {isOwn ? 'text-white/60' : 'text-muted'}">{item.domain}</p>
					</div>
				</div>
			</button>

		{:else if item.type === 'voice'}
			<!-- Voice note bubble -->
			<button onclick={handleTap} aria-label={item.autoCaption ? `Open voice note: ${item.autoCaption}` : 'Open voice note'} class="block {isOwn ? ownBubbleColor : otherBubbleColor} px-3.5 py-2.5">
				<div class="flex items-center gap-2">
					<Icon icon="ph:microphone" class="text-lg shrink-0" />
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<div class="flex-1 h-1 rounded-full {isOwn ? 'bg-white/30' : 'bg-muted/20'}">
								<div class="h-full rounded-full {isOwn ? 'bg-white/70' : 'bg-accent/50'}" style="width: 0%"></div>
							</div>
							<span class="text-[10px] font-medium tabular-nums shrink-0">{formatDurationMs(item.durationMs)}</span>
						</div>
						{#if item.autoCaption}
							<p class="text-[11px] {isOwn ? 'text-white/70' : 'text-muted'} mt-1 line-clamp-1">{item.autoCaption}</p>
						{/if}
					</div>
				</div>
			</button>

		{:else if item.type === 'list'}
			<!-- List bubble -->
			<button onclick={handleTap} class="block {isOwn ? ownBubbleColor : otherBubbleColor} px-3.5 py-2.5 text-left">
				<p class="text-[13px] font-semibold mb-1">{item.title}</p>
				{#each item.items.slice(0, 3) as listItem (listItem.id ?? listItem.text)}
					<div class="flex items-center gap-1.5 text-[12px]">
						<Icon icon={listItem.completed ? 'ph:check-circle-fill' : 'ph:circle'} class="text-sm shrink-0 {listItem.completed ? 'opacity-50' : ''}" />
						<span class="{listItem.completed ? 'line-through opacity-50' : ''} line-clamp-1">{listItem.text}</span>
					</div>
				{/each}
				{#if item.items.length > 3}
					<p class="text-[10px] {isOwn ? 'text-white/60' : 'text-muted'} mt-1">+{item.items.length - 3} more</p>
				{/if}
			</button>

		{:else if item.type === 'poll'}
			<!-- Poll bubble -->
			<button onclick={handleTap} class="block {isOwn ? ownBubbleColor : otherBubbleColor} px-3.5 py-2.5 text-left">
				<div class="flex items-center gap-1.5 mb-1">
					<Icon icon="ph:chart-bar" class="text-sm" />
					<p class="text-[13px] font-semibold">Poll</p>
				</div>
				<p class="text-[13px] leading-snug">{item.question}</p>
				<p class="text-[10px] {isOwn ? 'text-white/60' : 'text-muted'} mt-1">{item.options.length} options — tap to vote</p>
			</button>

		{:else if item.type === 'location'}
			<!-- Location bubble -->
			<button onclick={handleTap} class="block {isOwn ? ownBubbleColor : otherBubbleColor} px-3.5 py-2.5 text-left">
				<div class="flex items-center gap-2">
					<Icon icon="ph:map-pin-fill" class="text-lg shrink-0" />
					<div>
						{#if item.name}
							<p class="text-[13px] font-semibold leading-snug">{item.name}</p>
						{/if}
						<p class="text-[11px] {isOwn ? 'text-white/70' : 'text-muted'} leading-snug line-clamp-2">{item.address}</p>
					</div>
				</div>
			</button>
		{/if}

		<!-- Threaded comments -->
		{#if recentComments.length > 0}
			<div class="mt-1 ml-1 border-l-2 border-border-light pl-2.5 space-y-1">
				{#each recentComments as comment (comment.id)}
					{@const isCommentOwn = comment.authorId === $userStore.user?.uid}
					<div class="flex items-start gap-1.5">
						{#if !isCommentOwn && comment.authorPhotoURL}
							<img src={comment.authorPhotoURL} alt="" class="w-4 h-4 rounded-full object-cover mt-0.5 shrink-0" loading="lazy" />
						{:else if !isCommentOwn}
							<div class="w-4 h-4 rounded-full bg-surface-2 flex items-center justify-center text-[7px] text-muted font-semibold shrink-0 mt-0.5">
								{avatarInitial(comment.authorName)}
							</div>
						{/if}
						<div class="min-w-0">
							<p class="text-[11px] leading-snug text-on-surface">
								<span class="font-semibold text-muted">{isCommentOwn ? 'You' : comment.authorName}</span>
								<span class="ml-1">{comment.text}</span>
							</p>
						</div>
					</div>
				{/each}
				{#if comments.length > 3}
					<p class="text-[10px] text-muted/50">+{comments.length - 3} more</p>
				{/if}
			</div>
		{/if}

		<!-- Timestamp + Reply -->
		<div class="flex items-center gap-2 mt-0.5 px-1 {isOwn ? 'justify-end' : ''}">
			<span class="text-[10px] text-muted/40">{time}</span>
			<button
				onclick={handleReply}
				class="text-[10px] text-primary/60 hover:text-primary font-medium flex items-center gap-0.5 transition-colors"
			>
				<Icon icon="ph:arrow-bend-up-left" class="text-[10px]" />
				Reply{#if comments.length > 0}&nbsp;({comments.length}){/if}
			</button>
		</div>
	</div>
</div>
