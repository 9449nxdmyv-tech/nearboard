<!--
  @file Header.svelte
  @description Unified page header using Konsta UI Navbar.
               Supports large title (iOS-style collapse on scroll), back navigation, and right actions.
               Must be a direct child of Konsta <Page> for sticky + scroll behavior to work.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { Navbar, NavbarBackLink, Link } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		backHref,
		actions = [],
		leftActions = [],
		children,
		large = false,
		medium = false,
		titleSnippet,
		transparent = false,
		sticky = true,
	class: className = ''
	}: {
		title?: string;
		subtitle?: string;
		backHref?: string;
		actions?: Array<{
			icon: string;
			onClick: () => void;
			label?: string;
		}>;
		leftActions?: Array<{
			icon: string;
			onClick: () => void;
			label?: string;
		}>;
		children?: Snippet;
		large?: boolean;
		medium?: boolean;
		titleSnippet?: Snippet;
		transparent?: boolean;
		sticky?: boolean;
		class?: string;
	} = $props();

	const stickyClass = $derived(sticky ? `sticky top-0 z-40 ${className}`.trim() : className);

	function handleBack() {
		if (backHref) goto(backHref);
	}
</script>

{#snippet leftContent()}
	{#if backHref}
		<NavbarBackLink onClick={handleBack} />
	{/if}
	{#each leftActions as action (action.icon)}
		<Link onClick={action.onClick} iconOnly class="px-1">
			<Icon icon={action.icon} class="w-6 h-6" />
		</Link>
	{/each}
{/snippet}

{#snippet rightContent()}
	{#if children}
		{@render children()}
	{/if}
	{#each actions as action (action.icon)}
		<Link onClick={action.onClick} iconOnly class="px-1">
			<Icon icon={action.icon} class="w-6 h-6" />
		</Link>
	{/each}
{/snippet}

{#if titleSnippet}
	{#snippet navTitle()}
		{@render titleSnippet()}
	{/snippet}
	<Navbar
		title={navTitle}
		{subtitle}
		left={leftContent}
		right={rightContent}
		{large}
		{medium}
		{transparent}
		class={stickyClass}
	/>
{:else}
	<Navbar
		{title}
		{subtitle}
		left={leftContent}
		right={rightContent}
		{large}
		{medium}
		{transparent}
		class={stickyClass}
	/>
{/if}
