<!--
  @file AvatarStack.svelte
  @description Horizontal stack of member avatars with photos, initials fallback, and member count.
               Pass full MemberDoc[] via `members`, or pass `boardId` + `uids` to auto-fetch photos.
-->
<script lang="ts">
	import type { MemberDoc } from '$lib/types';
	import { doc, getDoc } from 'firebase/firestore';
	import { db } from '$lib/firebase/app';
	import { onMount, onDestroy } from 'svelte';
	import Icon from '@iconify/svelte';
	import { hapticLight } from '$lib/utils/haptics';
	import Avatar from './Avatar.svelte';

	let { members = [], uids = [], boardId = '', limit = 3, size = 'sm', showCount = false, onInvite, inviteLabel = 'Invite friends' }: {
		members?: MemberDoc[];
		uids?: string[];
		boardId?: string;
		limit?: number;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		showCount?: boolean;
		/** When provided, renders a dashed "+" tile at the end of the stack that invokes this callback. */
		onInvite?: () => void;
		inviteLabel?: string;
	} = $props();

	// ── Presence ticker ──
	// Drives the soft pulse on members currently viewing the board (lastViewedAt
	// within ~90s). Re-evaluates every 20s so the pulse fades naturally without
	// a server round-trip when a user closes the tab.
	const PRESENCE_WINDOW_MS = 90_000;
	let nowMs = $state(Date.now());
	let presenceTimer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		presenceTimer = setInterval(() => { nowMs = Date.now(); }, 20_000);
	});
	onDestroy(() => {
		if (presenceTimer) clearInterval(presenceTimer);
	});

	function isPresent(member: MemberDoc): boolean {
		const ts = member.lastViewedAt?.toMillis?.();
		if (!ts) return false;
		return nowMs - ts < PRESENCE_WINDOW_MS;
	}

	// Resolved member data (populated by fetch when using uids + boardId)
	let resolvedMembers = $state<MemberDoc[]>([]);

	// When boardId + uids are given, fetch only the specific member docs needed
	$effect(() => {
		if (members.length > 0 || !boardId || uids.length === 0) {
			resolvedMembers = [];
			return;
		}
		let cancelled = false;
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
			if (!cancelled) resolvedMembers = docs;
		});
		return () => { cancelled = true; };
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

	const moreSizeClass: Record<string, string> = {
		xs: 'w-5 h-5 text-[8px]',
		sm: 'w-7 h-7 text-[10px]',
		md: 'w-10 h-10 text-xs',
		lg: 'w-14 h-14 text-sm'
	};
</script>

<div class="flex items-center gap-1">
	<div class="flex items-center -space-x-2">
		{#each visible as member (member.userId)}
			<div class="ring-2 ring-surface rounded-full">
				<Avatar
					name={member.displayName || member.userId}
					photoURL={member.photoURL}
					{size}
					active={isPresent(member)}
				/>
			</div>
		{/each}

		{#if moreCount > 0}
			<div
				class="{moreSizeClass[size]} rounded-full border-2 border-surface bg-muted text-white flex items-center justify-center font-bold"
			>
				+{moreCount}
			</div>
		{/if}

		{#if onInvite}
			<button
				type="button"
				onclick={(e) => { e.stopPropagation(); hapticLight(); onInvite?.(); }}
				aria-label={inviteLabel}
				title={inviteLabel}
				class="{moreSizeClass[size]} rounded-full bg-surface text-accent
					border-2 border-dashed border-accent/40 hover:border-accent hover:bg-accent/8
					flex items-center justify-center press-scale transition-colors"
			>
				<Icon icon="ph:plus-bold" class="text-base" />
			</button>
		{/if}
	</div>

	{#if showCount}
		<span class="text-xs text-muted ml-1">{totalCount} {totalCount === 1 ? 'member' : 'members'}</span>
	{/if}
</div>
