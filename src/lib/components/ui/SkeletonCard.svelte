<!--
  @file SkeletonCard.svelte
  @description Skeleton loading placeholder for content cards.
               Updated with shimmer animation for native feel.
-->
<script lang="ts">
	import Skeleton from './Skeleton.svelte';

	let { variant = 'default' }: { variant?: 'default' | 'wide' | 'small' | 'photo' | 'voice' } = $props();
</script>

<div class="bg-card rounded-card shadow-card border border-border/50 overflow-hidden p-4">
	{#if variant === 'photo'}
		<!-- Photo card skeleton -->
		<Skeleton variant="image" class="mb-3" />
		<Skeleton variant="text" width="60%" class="mb-2" />
		<div class="flex items-center gap-2 pt-3 border-t border-border/50 mt-2">
			<Skeleton variant="avatar" />
			<Skeleton variant="text" width="40%" />
		</div>

	{:else if variant === 'voice'}
		<!-- Voice card skeleton -->
		<div class="h-20 bg-gradient-to-br from-purple-500/20 via-accent/20 to-indigo-500/20 rounded-xl mb-3 flex items-center justify-center">
			<div class="flex items-center gap-1">
				{#each Array(20) as _}
					<div class="w-1 bg-accent/30 rounded-full" style="height: {Math.random() * 24 + 8}px;"></div>
				{/each}
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Skeleton variant="avatar" />
			<Skeleton variant="text" width="50%" />
		</div>

	{:else if variant === 'wide'}
		<!-- Wide card skeleton -->
		<Skeleton variant="image" height="h-48" class="mb-3" />
		<Skeleton variant="text" width="70%" class="mb-2" />
		<Skeleton variant="text" width="50%" class="mb-3" />
		<div class="flex items-center gap-2 pt-3 border-t border-border/50">
			<Skeleton variant="avatar" />
			<Skeleton variant="text" width="30%" />
			<Skeleton variant="chip" class="ml-auto" />
		</div>

	{:else if variant === 'small'}
		<!-- Small/compact skeleton -->
		<div class="flex gap-3">
			<Skeleton variant="image" width="w-20" height="h-20" class="shrink-0" />
			<div class="flex-1 min-w-0">
				<Skeleton variant="text" width="80%" class="mb-2" />
				<Skeleton variant="text" width="60%" />
			</div>
		</div>

	{:else}
		<!-- Default card skeleton -->
		<Skeleton variant="image" class="mb-3" />
		<Skeleton variant="text" width="70%" class="mb-2" />
		<Skeleton variant="text" width="50%" class="mb-3" />
		<div class="flex items-center gap-2 pt-3 border-t border-border/50">
			<Skeleton variant="avatar" />
			<Skeleton variant="text" width="40%" />
			<Skeleton variant="chip" class="ml-auto" />
		</div>
	{/if}
</div>
