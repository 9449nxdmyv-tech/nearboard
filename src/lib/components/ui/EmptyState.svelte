<!--
  @file EmptyState.svelte
  @description Native-style empty state component. Clean, friendly, and actionable.
               Designed for mobile-first with appropriate spacing and touch targets.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '@iconify/svelte';
	import { fly } from 'svelte/transition';

	let {
		icon,
		title,
		description,
		actionLabel,
		onAction,
		secondaryActionLabel,
		onSecondaryAction,
		size = 'md'
	}: {
		icon?: string;
		title: string | Snippet;
		description?: string | Snippet;
		actionLabel?: string;
		onAction?: () => void;
		secondaryActionLabel?: string;
		onSecondaryAction?: () => void;
		size?: 'sm' | 'md' | 'lg';
	} = $props();

	const sizeClasses = {
		sm: { icon: 'text-3xl', title: 'text-sm', description: 'text-xs', padding: 'py-8 px-4' },
		md: { icon: 'text-5xl', title: 'text-base', description: 'text-sm', padding: 'py-12 px-6' },
		lg: { icon: 'text-7xl', title: 'text-lg', description: 'text-base', padding: 'py-16 px-8' }
	};

	const defaultIcons: Record<string, string> = {
		empty: 'ph:folder-open',
		search: 'ph:magnifying-glass',
		offline: 'ph:wifi-slash',
		error: 'ph:warning-circle',
		success: 'ph:check-circle',
		note: 'ph:note',
		board: 'ph:kanban',
		voice: 'ph:microphone',
		photo: 'ph:image',
		link: 'ph:link-simple'
	};

	const displayIcon = $derived(icon || 'ph:folder-open');
</script>

<div class="flex flex-col items-center justify-center text-center {sizeClasses[size].padding}" in:fly={{ y: 12, duration: 300 }}>
	<!-- Icon with background -->
	<div class="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-surface-1 border border-border/50 flex items-center justify-center mb-4 shadow-sm">
		<Icon icon={displayIcon} class="{sizeClasses[size].icon} text-on-surface/40" />
	</div>

	<!-- Title -->
	{#if typeof title === 'string'}
		<h3 class="{sizeClasses[size].title} font-semibold text-primary tracking-tight mb-1.5">
			{title}
		</h3>
	{:else}
		<div class="{sizeClasses[size].title} font-semibold text-primary tracking-tight mb-1.5">
			{@render title()}
		</div>
	{/if}

	<!-- Description -->
	{#if description}
		{#if typeof description === 'string'}
			<p class="{sizeClasses[size].description} text-muted/70 leading-relaxed max-w-[260px] mb-5">
				{description}
			</p>
		{:else}
			<div class="{sizeClasses[size].description} text-muted/70 leading-relaxed max-w-[260px] mb-5">
				{@render description()}
			</div>
		{/if}
	{/if}

	<!-- Actions -->
	{#if actionLabel}
		<div class="flex items-center gap-2.5">
			<button
				onclick={onAction}
				class="px-5 py-2.5 bg-accent text-white rounded-full text-sm font-semibold
					shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30
					active:scale-[0.96] transition-all duration-150 press-scale"
			>
				{actionLabel}
			</button>
			{#if secondaryActionLabel && onSecondaryAction}
				<button
					onclick={onSecondaryAction}
					class="px-5 py-2.5 bg-surface text-primary rounded-full text-sm font-semibold
						border border-border/60 hover:border-accent/40 hover:bg-accent/5
						active:scale-[0.96] transition-all duration-150"
				>
					{secondaryActionLabel}
				</button>
			{/if}
		</div>
	{/if}
</div>
