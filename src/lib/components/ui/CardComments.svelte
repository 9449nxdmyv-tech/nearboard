<!--
  @file CardComments.svelte
  @description Chat-style comment thread. Own messages aligned right with accent bubble,
               others aligned left with neutral bubble. Max 280 chars.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import ChatInput from './ChatInput.svelte';
	import { userStore } from '$lib/stores';
	import { subscribeToComments, addComment, deleteComment } from '$lib/firebase/boardService';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import type { CommentDoc } from '$lib/types';

	let { boardId, contentId, isBoardOwner = false, allowComments = true }: {
		boardId: string;
		contentId: string;
		isBoardOwner?: boolean;
		allowComments?: boolean;
	} = $props();

	let comments = $state<CommentDoc[]>([]);
	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const charLimit = 280;
	const charsLeft = $derived(charLimit - text.length);

	onMount(() => {
		return subscribeToComments(boardId, contentId, (items) => {
			comments = items;
		});
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const user = $userStore.user;
		if (!user || !text.trim() || busy || !allowComments) return;

		busy = true;
		error = null;
		try {
			const mentions = text.match(/@(\w+)/g)?.map(m => m.slice(1)) || [];

			await addComment(
				boardId,
				contentId,
				user.uid,
				user.displayName || 'Someone',
				user.photoURL,
				text.trim(),
				mentions
			);

			text = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to post comment';
		} finally {
			busy = false;
		}
	}

	async function handleDelete(commentId: string) {
		try {
			await deleteComment(boardId, contentId, commentId);
		} catch {
			error = 'Failed to delete comment';
		}
	}
</script>

<div class="flex flex-col gap-2 py-1">
	{#if comments.length > 0}
		<div class="flex flex-col gap-1.5 px-0.5">
			{#each comments as comment (comment.id)}
				{@const isOwn = comment.authorId === $userStore.user?.uid}
				<div
					class="flex gap-2 {isOwn ? 'flex-row-reverse' : ''}"
					in:scale={{ start: 0.85, duration: 250, easing: backOut, opacity: 0 }}
				>
					<!-- Avatar (other users only) -->
					{#if !isOwn}
						{#if comment.authorPhotoURL}
							<img src={comment.authorPhotoURL} alt=""
								width="24" height="24" loading="lazy"
								class="w-6 h-6 rounded-full shrink-0 object-cover mt-0.5"
								onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
						{:else}
							<div class="w-6 h-6 rounded-full bg-surface-1 flex items-center justify-center text-[9px] text-muted font-semibold shrink-0 mt-0.5">
								{avatarInitial(comment.authorName)}
							</div>
						{/if}
					{/if}

					<!-- Bubble -->
					<div class="max-w-[80%] group">
						<div class="{isOwn
							? 'bg-accent text-white rounded-2xl rounded-br-md'
							: 'bg-surface-1 text-on-surface rounded-2xl rounded-bl-md'} px-3 py-2">
							{#if !isOwn}
								<p class="text-[10px] font-semibold text-muted mb-0.5">{comment.authorName}</p>
							{/if}
							<p class="text-[13px] leading-relaxed break-words">{comment.text}</p>
						</div>
						<div class="flex items-center gap-2 mt-0.5 px-1 {isOwn ? 'justify-end' : ''}">
							<span class="text-[10px] text-muted/50">{relativeTime(comment.createdAt?.toDate() ?? new Date())}</span>
							{#if isBoardOwner || isOwn}
								<button
									onclick={() => handleDelete(comment.id)}
									class="text-[10px] text-muted/40 hover:text-error active:text-error transition-colors"
									aria-label="Delete comment"
								>
									<Icon icon="ph:trash" class="text-xs" />
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center gap-1 py-3 text-center">
			<Icon icon="ph:chat-circle-dots" class="text-xl text-muted/20" />
			<p class="text-[11px] text-muted/40">No comments yet</p>
		</div>
	{/if}

	{#if allowComments}
		<form onsubmit={handleSubmit} class="mt-1">
			<ChatInput
				bind:value={text}
				placeholder="Message..."
				size="sm"
				maxlength={charLimit}
				disabled={busy}
			/>
			{#if error}
				<p class="text-[10px] text-error mt-1 px-1">{error}</p>
			{/if}
			{#if charsLeft <= 30}
				<p class="text-[10px] tabular-nums text-right mt-0.5 px-1 {charsLeft <= 10 ? 'text-error font-bold' : 'text-muted/40'}">{charsLeft}</p>
			{/if}
		</form>
	{:else}
		<p class="text-[10px] text-muted/40 text-center italic py-2">
			Comments are disabled for this board.
		</p>
	{/if}
</div>
