<!--
  @file PollCard.svelte
  @description Poll card with live vote counts.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { userStore, showToast } from '$lib/stores';
	import { voteOnPoll, removeVote, subscribeToVotes } from '$lib/firebase/boardService';
	import { hapticLight } from '$lib/utils/haptics';
	import Card from './Card.svelte';
	import MetadataPill from '$lib/components/cards/link/MetadataPill.svelte';
	import type { VoteDoc } from '$lib/types';

	let {
		id, boardId, question, options,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare, onCommentClick,
		layout
	}: {
		id: string;
		boardId: string;
		question: string;
		options: { id: string; text: string }[];
		authorId: string;
		authorName: string;
		authorPhotoURL: string | null;
		createdAt: Date;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		expandComments?: boolean;
		commentCount?: number;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
		layout?: import('$lib/types').LayoutStyle;
	} = $props();

	let votes = $state<VoteDoc[]>([]);

	const totalVotes = $derived(votes.length);
	const userVote = $derived(votes.find((v) => v.userId === $userStore.user?.uid));

	const voteCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const vote of votes) {
			counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
		}
		return counts;
	});

	function getVotePercent(optionId: string) {
		if (totalVotes === 0) return 0;
		return ((voteCounts.get(optionId) ?? 0) / totalVotes) * 100;
	}

	$effect(() => {
		return subscribeToVotes(boardId, id, (v) => {
			votes = v;
		});
	});

	async function handleVote(optionId: string) {
		if (!$userStore.user) return;
		hapticLight();
		try {
			if (userVote?.optionId === optionId) {
				await removeVote(boardId, id, $userStore.user.uid);
			} else {
				await voteOnPoll(boardId, id, $userStore.user.uid, optionId);
			}
		} catch (err) {
			console.error('[PollCard] vote failed', err);
			showToast("Couldn't update your vote — try again", 'error');
		}
	}
</script>

<Card
	{boardId}
	contentId={id}
	{authorId}
	{authorName}
	{authorPhotoURL}
	{createdAt}
	{isBoardOwner}
	{allowComments}
	{expandComments}
	{commentCount}
	{acknowledgments}
	{onDelete}
	{onShare}
	{onCommentClick}
	{layout}
>
	<h3 class="font-semibold text-on-surface text-[14px] leading-snug mb-3 tracking-tight">{question}</h3>

	<div class="flex flex-col gap-2">
		{#each options as opt}
			{@const percent = getVotePercent(opt.id)}
			{@const isSelected = userVote?.optionId === opt.id}

			<button
				onclick={(e) => { e.stopPropagation(); handleVote(opt.id); }}
				class="relative w-full text-left px-3 py-2.5 rounded-xl border transition-all overflow-hidden
					{isSelected ? 'border-accent/40 bg-accent/5' : 'border-border bg-surface-1/50 hover:border-accent/20'}"
			>
				<div
					class="absolute inset-0 bg-accent/8 origin-left transition-transform duration-500 ease-out"
					style="transform: scaleX({percent / 100})"
				></div>

				<div class="relative flex items-center justify-between gap-2">
					<span class="text-[13px] font-medium line-clamp-2 {isSelected ? 'text-accent' : 'text-on-surface'}">
						{opt.text}
					</span>
					<div class="flex items-center gap-2 shrink-0">
						{#if isSelected}
							<MetadataPill icon="ph:check-circle-fill" text="Your vote" variant="surface" />
						{/if}
						{#if totalVotes > 0}
							<span class="text-[11px] text-muted font-medium tabular-nums">{Math.round(percent)}%</span>
						{/if}
					</div>
				</div>
			</button>
		{/each}
	</div>

	<p class="text-[10px] text-muted font-medium mt-2.5">
		{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
	</p>
</Card>
