<!--
  @file MetadataPill.svelte
  @description Unified metadata badge. Used on images (glass) and on surfaces.
               Consistent across all card types for cohesive UI.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let {
		icon,
		iconColor,
		text,
		variant = 'glass'
	}: {
		icon?: string;
		iconColor?: string;
		text: string;
		variant?: 'glass' | 'surface' | 'rating';
	} = $props();

	const classes = $derived(
		variant === 'glass'
			? 'bg-black/40 backdrop-blur-xl text-white/95 border border-white/[0.08] shadow-lg'
			: variant === 'rating'
				? 'bg-[color:var(--color-rating-pill-bg)] text-[color:var(--color-rating-pill-text)] border-[color:var(--color-rating-pill-border)] shadow-sm shadow-[color:var(--color-rating-pill-shadow)]'
				: 'bg-surface text-muted border border-border/50'
	);
</script>

<span class="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[10px] font-semibold tracking-tight {classes}">
	{#if icon}
		<Icon {icon} class="text-[11px]" style={iconColor ? `color: ${iconColor}` : ''} />
	{/if}
	{text}
</span>
