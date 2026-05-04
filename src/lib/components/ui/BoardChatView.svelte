<!--
  @file BoardChatView.svelte
  @description Chat-mode board view. Renders content as a chronological message
               thread with date dividers, chat bubbles, and a sticky input bar.
               Oldest messages at top, newest at bottom, auto-scrolls on new content.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '@iconify/svelte';
	import type { ContentDoc, BoardDoc, NoteContentDoc, LinkContentDoc } from '$lib/types';
	import { userStore, showToast } from '$lib/stores';
	import { addContent } from '$lib/firebase';
	import { isValidUrl } from '$lib/utils/contentDetection';
	import { extractMetadata } from '$lib/api';
	import ChatBubble from './ChatBubble.svelte';
	import ChatInput from './ChatInput.svelte';

	let {
		board,
		content,
		boardId,
		isOwner = false,
		onDetailOpen,
		onReplyOpen
	}: {
		board: BoardDoc | null;
		content: ContentDoc[];
		boardId: string;
		isOwner?: boolean;
		onDetailOpen?: (itemId: string) => void;
		onReplyOpen?: (itemId: string) => void;
	} = $props();

	let text = $state('');
	let sending = $state(false);
	let scrollContainer = $state<HTMLDivElement | undefined>();
	let isAtBottom = $state(true);
	let prevContentLength = $state(0);

	// Sort chronologically (oldest first) for chat layout
	const chronological = $derived([...content].sort((a, b) => {
		const aMs = a.createdAt?.toMillis?.() ?? 0;
		const bMs = b.createdAt?.toMillis?.() ?? 0;
		return aMs - bMs;
	}));

	// Group messages by date for dividers
	const grouped = $derived.by(() => {
		const groups: { label: string; items: ContentDoc[] }[] = [];
		let currentLabel = '';
		for (const item of chronological) {
			const date = item.createdAt?.toDate?.() ?? new Date();
			const label = formatDateLabel(date);
			if (label !== currentLabel) {
				currentLabel = label;
				groups.push({ label, items: [] });
			}
			groups[groups.length - 1].items.push(item);
		}
		return groups;
	});

	function formatDateLabel(date: Date): string {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
	}

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
	}

	async function scrollToBottom(smooth = false) {
		await tick();
		if (scrollContainer) {
			scrollContainer.scrollTo({
				top: scrollContainer.scrollHeight,
				behavior: smooth ? 'smooth' : 'instant'
			});
		}
	}

	// Auto-scroll when new content arrives and user is at bottom
	$effect(() => {
		const len = chronological.length;
		if (len > prevContentLength && isAtBottom) {
			scrollToBottom(prevContentLength > 0);
		}
		prevContentLength = len;
	});

	onMount(() => {
		scrollToBottom();
	});

	async function handleSubmit() {
		const user = $userStore.user;
		if (!user || !text.trim() || sending) return;

		sending = true;
		const trimmed = text.trim();
		text = '';

		try {
			// Detect URL in text
			const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
			const foundUrl = urlMatch?.[0] ?? (isValidUrl(trimmed) ? trimmed : null);

			const authorBase = {
					boardId,
					authorId: user.uid,
					authorName: user.displayName || 'Someone',
					authorPhotoURL: user.photoURL
				};

			if (foundUrl) {
				// Link content
				const meta = await extractMetadata(foundUrl).catch(() => null);
				const domain = (() => { try { return new URL(foundUrl).hostname.replace('www.', ''); } catch { return ''; } })();
				await addContent(boardId, {
					type: 'link',
					url: foundUrl,
					title: meta?.title ?? foundUrl,
					description: meta?.description ?? null,
					image: meta?.image ?? null,
					domain,
					favicon: null,
					enrichment: meta?.enrichment ?? null,
					userIntent: 'Chat message with link',
					...authorBase
				} as Omit<LinkContentDoc, 'id' | 'createdAt'>);
			} else {
				// Note content
				await addContent(boardId, {
					type: 'note',
					text: trimmed,
					userIntent: 'Chat message',
					...authorBase
				} as Omit<NoteContentDoc, 'id' | 'createdAt'>);
			}
		} catch {
			showToast('Failed to send message');
			text = trimmed; // Restore text on failure
		} finally {
			sending = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleBubbleTap(item: ContentDoc) {
		onDetailOpen?.(item.id);
	}

	function handleBubbleReply(item: ContentDoc) {
		onReplyOpen?.(item.id);
	}
</script>

<div class="flex flex-col h-full">
	<!-- Messages area -->
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="flex-1 overflow-y-auto px-3 py-3"
	>
		{#if chronological.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 text-center">
				<Icon icon="ph:chat-circle-dots" class="text-4xl text-muted/20" />
				<p class="text-sm text-muted/50">No messages yet</p>
				<p class="text-xs text-muted/30">Start the conversation below</p>
			</div>
		{:else}
			{#each grouped as group (group.label)}
				<!-- Date divider -->
				<div class="flex items-center gap-3 my-4 first:mt-1">
					<div class="flex-1 h-px bg-border-light"></div>
					<span class="text-[10px] font-semibold text-muted/50 uppercase tracking-wider shrink-0">{group.label}</span>
					<div class="flex-1 h-px bg-border-light"></div>
				</div>

				<!-- Messages in this date group -->
				{#each group.items as item (item.id)}
					<div class="mb-2">
						<ChatBubble {item} onTap={handleBubbleTap} onReply={handleBubbleReply} />
					</div>
				{/each}
			{/each}
		{/if}
	</div>

	<!-- Scroll-to-bottom FAB (when scrolled up) -->
	{#if !isAtBottom && chronological.length > 0}
		<button
			onclick={() => scrollToBottom(true)}
			aria-label="Scroll to latest messages"
			class="absolute bottom-20 right-4 w-9 h-9 rounded-full bg-surface-2 shadow-lg flex items-center justify-center text-muted active:scale-90 transition-transform z-10"
		>
			<Icon icon="ph:arrow-down" class="text-lg" />
		</button>
	{/if}

	<!-- Sticky input bar -->
	<div class="shrink-0 border-t border-border-light bg-surface px-3 py-2 pb-safe">
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
			<ChatInput
				bind:value={text}
				placeholder="Message {board?.name ?? 'board'}..."
				size="lg"
				disabled={sending}
				onkeydown={handleKeydown}
			/>
		</form>
	</div>
</div>
