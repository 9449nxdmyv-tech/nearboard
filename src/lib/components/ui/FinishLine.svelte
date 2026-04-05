<!--
  @file FinishLine.svelte
  @description A calm, minimal "You're all caught up" end state for feeds.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fade, scale } from 'svelte/transition';
</script>

<div
	class="flex flex-col items-center justify-center py-16 px-6 text-center"
	in:fade={{ duration: 800, delay: 200 }}
>
	<div
		class="w-12 h-12 rounded-full bg-accent/5 flex items-center justify-center mb-4"
		in:scale={{ duration: 500, delay: 400, start: 0.5 }}
	>
		<Icon icon="ph:check-circle-fill" class="text-2xl text-on-surface/40" />
	</div>

	<h2 class="font-display text-lg font-semibold text-primary mb-1">
		You're all caught up.
	</h2>
	<p class="text-sm text-muted max-w-[240px] leading-relaxed">
		Nothing new right now. Come back later.
	</p>
</div>
