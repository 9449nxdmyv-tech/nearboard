<!--
  @file PlusBadge.svelte
  @description Small star icon shown next to a Plus subscriber's name.
               Visual only — no interaction. Used in CardFooter, profile,
               and member lists.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let { size = 'sm' }: { size?: 'sm' | 'md' } = $props();
</script>

<span
	class="inline-flex items-center justify-center rounded-full bg-accent/15 text-accent shrink-0
		{size === 'md' ? 'w-4 h-4' : 'w-3 h-3'}"
	title="Plus supporter"
	aria-label="Plus supporter"
>
	<Icon icon="ph:star-fill" class={size === 'md' ? 'text-[10px]' : 'text-[8px]'} />
</span>
