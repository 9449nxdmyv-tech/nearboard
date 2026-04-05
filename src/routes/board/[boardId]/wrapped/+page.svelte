<!--
  @file board/[boardId]/wrapped/+page.svelte
  @description Nearboard Wrapped — annual year-in-review card per board.
  @todos
    - MED UX: Add share-to-Instagram-Stories button (9:16 canvas export)
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { Page } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import type { WrappedDoc } from '$lib/types';

	const boardId = $derived($page.params.boardId ?? '');
	let wrapped = $state<WrappedDoc | null>(null);
	let loading = $state(true);

	interface StatCard {
		value: string;
		label: string;
	}

	let statCards = $derived<StatCard[]>(
		wrapped
			? [
					{ value: String(wrapped.itemsAdded), label: 'Items Added' },
					{ value: String(wrapped.productsSaved), label: 'Products Saved' },
					{ value: String(wrapped.voiceNotesRecorded), label: 'Voice Notes' },
					{ value: `${wrapped.longestStreak}d`, label: 'Longest Streak' }
				]
			: []
	);

	onMount(async () => {
		const { doc, getDoc } = await import('firebase/firestore');
		const { db } = await import('$lib/firebase/app');
		const year = new Date().getFullYear();
		const snap = await getDoc(doc(db(), 'boards', boardId, 'wrapped', String(year)));
		if (snap.exists()) {
			wrapped = snap.data() as WrappedDoc;
		}
		loading = false;
	});
</script>

<Page>
<div class="flex flex-col h-screen bg-gradient-to-b from-[#6C63FF] to-[#1A1A2E]">
	<Header
		title="Wrapped {new Date().getFullYear()}"
		backHref="/board/{boardId}"
	/>

	<div class="flex-1 flex items-center justify-center px-6">
		{#if loading}
			<div class="flex flex-col items-center gap-3">
					<div class="w-10 h-10 rounded-full bg-white/10 skeleton-shimmer"></div>
					<p class="text-white/60 text-[13px]">Loading your Wrapped...</p>
				</div>
		{:else if !wrapped}
			<div class="text-center">
				<Icon icon="ph:sparkle" class="text-4xl text-white/60 mx-auto mb-3" />
				<p class="text-white/80 text-sm">No Wrapped available yet for this board.</p>
				<p class="text-white/50 text-xs mt-2">Wrapped is generated on December 1st each year.</p>
			</div>
		{:else}
			<div
				in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
				class="bg-white/10 backdrop-blur-lg rounded-[20px] p-8 max-w-sm w-full text-center shadow-xl"
			>
				<h2 class="text-[26px] font-bold text-white tracking-tight mb-6">
					{wrapped.year} Wrapped
				</h2>

				<div class="grid grid-cols-2 gap-3 mb-6">
					{#each statCards as stat, i (stat.label)}
						<div
							class="bg-white/10 rounded-2xl p-4 stagger-fade-in"
							style="--stagger-index: {i}"
						>
							<div class="text-[22px] font-bold text-white tabular-nums">{stat.value}</div>
							<div class="text-[11px] text-white/60 font-medium">{stat.label}</div>
						</div>
					{/each}
				</div>

				<div
					class="bg-white/10 rounded-2xl p-4 mb-6 stagger-fade-in"
					style="--stagger-index: {statCards.length}"
				>
					<div class="text-[10px] text-white/60 uppercase tracking-wider font-semibold mb-1">MVP</div>
					<div class="text-[15px] font-semibold text-white">
						{wrapped.mostActiveMember.name}
					</div>
					<div class="text-[11px] text-white/40 tabular-nums">
						{wrapped.mostActiveMember.count} contributions
					</div>
				</div>

				<p
					class="text-[13px] text-white/80 leading-relaxed italic stagger-fade-in"
					style="--stagger-index: {statCards.length + 1}"
				>
					"{wrapped.narrative}"
				</p>
			</div>
		{/if}
	</div>
</div>
</Page>
