<!--
  @file AvatarStack.svelte
  @description Horizontal stack of member avatars with photos, initials fallback, and member count.
               Pass full MemberDoc[] via `members`, or pass `boardId` + `uids` to auto-fetch photos.
-->
<script lang="ts">
	import type { MemberDoc } from '$lib/types';
	import { doc, getDoc } from 'firebase/firestore';
	import { db } from '$lib/firebase/app';
	import { avatarInitial } from '$lib/utils/textFormatter';

	let { members = [], uids = [], boardId = '', limit = 3, size = 'sm', showCount = false }: {
		members?: MemberDoc[];
		uids?: string[];
		boardId?: string;
		limit?: number;
		size?: 'xs' | 'sm' | 'md';
		showCount?: boolean;
	} = $props();

	// Resolved member data (populated by fetch when using uids + boardId)
	let resolvedMembers = $state<MemberDoc[]>([]);

	// When boardId + uids are given, fetch only the specific member docs needed
	$effect(() => {
		if (members.length > 0 || !boardId || uids.length === 0) {
			resolvedMembers = [];
			return;
		}
		Promise.all(
			uids.map(async (uid) => {
				try {
					const snap = await getDoc(doc(db(), 'boards', boardId, 'members', uid));
					if (snap.exists()) return { ...snap.data(), userId: snap.id } as MemberDoc;
					return { userId: uid, displayName: '', photoURL: null } as MemberDoc;
				} catch {
					return { userId: uid, displayName: '', photoURL: null } as MemberDoc;
				}
			})
		).then((docs) => {
			resolvedMembers = docs;
		});
	});

	// Normalize: prefer explicit members, then resolved, then stubs
	const items = $derived(
		members.length > 0
			? members
			: resolvedMembers.length > 0
				? uids.map((uid) => resolvedMembers.find((m) => m.userId === uid) ?? { userId: uid, displayName: '', photoURL: null } as MemberDoc)
				: uids.map((uid) => ({ userId: uid, displayName: '', photoURL: null }) as MemberDoc)
	);

	const visible = $derived(items.slice(0, limit));
	const moreCount = $derived(Math.max(0, items.length - limit));
	const totalCount = $derived(items.length);

	const sizeClasses: Record<string, string> = {
		xs: 'w-5 h-5 text-[8px]',
		sm: 'w-7 h-7 text-[10px]',
		md: 'w-10 h-10 text-xs'
	};

	function initial(member: MemberDoc): string {
		return avatarInitial(member.displayName || member.userId);
	}
</script>

<div class="flex items-center gap-1">
	<div class="flex items-center -space-x-2">
		{#each visible as member}
			{#if member.photoURL}
				<img
					src={member.photoURL}
					alt={member.displayName || 'Member'}
					class="{sizeClasses[size]} rounded-full border-2 border-surface ring-1 ring-border object-cover"
					title={member.displayName || member.userId}
				/>
			{:else}
				<div
					class="{sizeClasses[size]} rounded-full border-2 border-surface bg-accent/10 flex items-center justify-center text-accent font-bold ring-1 ring-border"
					title={member.displayName || member.userId}
				>
					{initial(member)}
				</div>
			{/if}
		{/each}

		{#if moreCount > 0}
			<div
				class="{sizeClasses[size]} rounded-full border-2 border-surface bg-muted text-white flex items-center justify-center font-bold ring-1 ring-border"
			>
				+{moreCount}
			</div>
		{/if}
	</div>

	{#if showCount}
		<span class="text-xs text-muted ml-1">{totalCount} {totalCount === 1 ? 'member' : 'members'}</span>
	{/if}
</div>
