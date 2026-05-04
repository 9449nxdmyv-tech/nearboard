<!--
  @file CardFooter.svelte
  @description Author avatar + name + relative timestamp. Compact single-line meta.
-->
<script lang="ts">
	import type { Timestamp } from 'firebase/firestore';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import Avatar from './Avatar.svelte';

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
	<Avatar name={authorName} photoURL={authorPhotoURL} size="sm" ring="surface" />
	<span class="text-[13px] text-on-surface font-medium truncate">{authorName}</span>
	<span class="text-[11px] text-muted shrink-0 ml-auto">{relativeTime(date)}</span>
</div>
