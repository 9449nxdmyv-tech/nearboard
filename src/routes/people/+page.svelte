<!--
  @file people/+page.svelte
  @description Shows all unique members across the user's boards with board stats.
-->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { Page } from 'konsta/svelte';
	import { boardStore, userStore } from '$lib/stores';
	import { getPublicUserProfiles } from '$lib/firebase';
	import type { PublicUserProfile } from '$lib/firebase';

	const currentUser = $derived($userStore.user);
	const boards = $derived($boardStore.boards);

	let people = $state<PublicUserProfile[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (!currentUser || !boards.length) {
			loading = false;
			return;
		}

		const uniqueIds = [...new Set(boards.flatMap((b) => b.memberIds))].filter(
			(id) => id !== currentUser.uid
		);

		if (uniqueIds.length === 0) {
			people = [];
			loading = false;
			return;
		}

		loading = true;
		getPublicUserProfiles(uniqueIds).then((profiles) => {
			people = profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
			loading = false;
		});
	});

	function getBoardCount(userId: string): number {
		return boards.filter((b) => b.memberIds.includes(userId)).length;
	}

	function getOwnedCount(userId: string): number {
		return boards.filter((b) => b.ownerId === userId).length;
	}
</script>

<svelte:head>
	<title>Friends — Nearboard</title>
</svelte:head>

<Page>
	<PageHeader title="Friends" />

	<div class="px-4 sm:px-6 py-5">
		{#if loading}
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
				{#each Array(8) as _}
					<div class="bg-card rounded-card border border-border/50 p-5 animate-pulse">
						<div class="w-14 h-14 rounded-full bg-border/60 mx-auto mb-3"></div>
						<div class="h-3.5 bg-border/60 rounded-full w-2/3 mx-auto mb-2.5"></div>
						<div class="h-2.5 bg-border/40 rounded-full w-1/2 mx-auto"></div>
					</div>
				{/each}
			</div>
		{:else if people.length === 0}
			<div class="flex flex-col items-center justify-center py-24">
				<div class="w-16 h-16 rounded-full bg-accent/8 flex items-center justify-center mb-4">
					<Icon icon="ph:users" class="text-3xl text-on-surface/40" />
				</div>
				<p class="text-primary font-semibold text-[15px]">No friends yet</p>
				<p class="text-sm text-muted mt-1.5 text-center max-w-[240px]">Join or create boards to see friends here.</p>
			</div>
		{:else}
			<p class="text-[13px] text-muted mb-4 px-1">
				{people.length} {people.length === 1 ? 'friend' : 'friends'} across your boards
			</p>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
				{#each people as person, i (person.uid)}
					<a
						href="/u/{person.uid}"
						class="group relative bg-card rounded-card shadow-card border border-border/50 overflow-hidden
							hover:border-accent/30 hover:shadow-lg transition-all duration-200 active:scale-[0.97]"
						in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration, delay: Math.min(i * 30, 300) }}
					>
						<!-- Subtle accent gradient header -->
						<div class="h-12 bg-gradient-to-br from-accent/8 via-accent/4 to-transparent"></div>

						<!-- Avatar — overlapping header -->
						<div class="flex flex-col items-center -mt-8 px-4 pb-4">
							{#if person.photoURL}
								<img
									src={person.photoURL}
									alt={person.displayName}
									class="w-14 h-14 rounded-full object-cover ring-3 ring-card shadow-md mb-2.5
										group-hover:ring-accent/20 transition-all duration-200"
								/>
							{:else}
								<div class="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center
									text-xl text-accent font-bold ring-3 ring-card shadow-md mb-2.5
									group-hover:ring-accent/20 transition-all duration-200">
									{avatarInitial(person.displayName)}
								</div>
							{/if}

							<p class="text-[13px] font-semibold text-primary truncate w-full text-center leading-tight">
								{person.displayName}
							</p>

							<!-- Stats row -->
							<div class="flex items-center justify-center gap-3 mt-2">
								<div class="flex items-center gap-1 text-muted">
									<Icon icon="ph:squares-four" class="text-[11px]" />
									<span class="text-[11px] font-medium">{getBoardCount(person.uid)}</span>
								</div>
								{#if getOwnedCount(person.uid) > 0}
									<div class="flex items-center gap-1 text-warning">
										<Icon icon="ph:crown-simple" class="text-[11px]" />
										<span class="text-[11px] font-medium">{getOwnedCount(person.uid)}</span>
									</div>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</Page>
