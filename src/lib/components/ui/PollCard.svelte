<!--
  @file PollCard.svelte
  @description Poll card with live vote counts.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { userStore } from '$lib/stores';
	import { voteOnPoll, subscribeToVotes } from '$lib/firebase/boardService';
	import { hapticLight } from '$lib/utils/haptics';
	import CardFooterSection from './CardFooterSection.svelte';
	import MetadataPill from '$lib/components/cards/link/MetadataPill.svelte';
	import type { VoteDoc } from '$lib/types';

	let {
		id, boardId, question, options,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare
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
		await voteOnPoll(boardId, id, $userStore.user.uid, optionId);
	}
</script>

<article class="bg-card rounded-card shadow-card border border-border/50 overflow-hidden card-hover group">
	<div class="p-4">
		<h3 class="font-semibold text-primary text-[14px] leading-snug mb-3 tracking-tight">{question}</h3>

		<div class="flex flex-col gap-2">
			{#each options as opt}
				{@const percent = getVotePercent(opt.id)}
				{@const isSelected = userVote?.optionId === opt.id}

				<button
					onclick={() => handleVote(opt.id)}
					class="relative w-full text-left px-3 py-2.5 rounded-xl border transition-all overflow-hidden
						{isSelected ? 'border-accent/40 bg-accent/5' : 'border-border bg-surface/50 hover:border-accent/20'}"
				>
					<div
						class="absolute inset-0 bg-accent/8 origin-left transition-transform duration-500 ease-out"
						style="transform: scaleX({percent / 100})"
					></div>

					<div class="relative flex items-center justify-between gap-2">
						<span class="text-[13px] font-medium line-clamp-2 {isSelected ? 'text-accent' : 'text-primary'}">
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
	</div>

	<CardFooterSection {boardId} contentId={id} {authorId} {authorName} {authorPhotoURL} {createdAt} {isBoardOwner} {allowComments} {expandComments} {commentCount} {acknowledgments} {onDelete} {onShare} />
</article>
