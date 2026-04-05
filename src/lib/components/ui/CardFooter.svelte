<!--
  @file CardFooter.svelte
  @description Author avatar + name + relative timestamp. Compact single-line meta.
-->
<script lang="ts">
	import type { Timestamp } from 'firebase/firestore';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { avatarInitial } from '$lib/utils/textFormatter';

	let {
		authorName,
		authorPhotoURL,
		createdAt
	}: {
		authorName: string;
		authorPhotoURL: string | null;
		createdAt: Date | Timestamp;
	} = $props();

	const date = $derived(createdAt instanceof Date ? createdAt : createdAt.toDate());
</script>

<div class="flex items-center gap-2 min-w-0">
	{#if authorPhotoURL}
		<img
			src={authorPhotoURL}
			alt={authorName}
			class="w-7 h-7 rounded-full shrink-0 object-cover ring-2 ring-surface-1"
			onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
		/>
	{:else}
		<div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] text-primary font-semibold shrink-0">
			{avatarInitial(authorName)}
		</div>
	{/if}
	<span class="text-[13px] text-on-surface font-medium truncate">{authorName}</span>
	<span class="text-[11px] text-muted shrink-0 ml-auto">{relativeTime(date)}</span>
</div>
