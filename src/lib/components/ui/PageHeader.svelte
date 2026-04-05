<!--
  @file PageHeader.svelte
  @description Page header using Konsta UI Navbar for native iOS/Material look.
-->
<script lang="ts">
	import { Navbar, NavbarBackLink } from 'konsta/svelte';
	import { goto } from '$app/navigation';

	let {
		title,
		subtitle,
		backHref,
		children,
		sticky = true,
		headerHeight = $bindable(),
		titleSnippet
	}: {
		title?: string;
		subtitle?: string;
		backHref?: string;
		children?: import('svelte').Snippet;
		sticky?: boolean;
		headerHeight?: number;
		titleSnippet?: import('svelte').Snippet;
	} = $props();

	let headerEl: HTMLElement | null = null;

	$effect(() => {
		if (headerEl && headerHeight !== undefined) {
			const updateHeight = () => {
				if (headerHeight !== undefined) {
					headerHeight = headerEl!.offsetHeight;
				}
			};
			updateHeight();
			const observer = new ResizeObserver(updateHeight);
			observer.observe(headerEl);
			return () => observer.disconnect();
		}
	});
</script>

<div bind:this={headerEl} class={sticky ? 'sticky top-0 z-40' : ''}>
	{#snippet navLeft()}
		{#if backHref}
			<NavbarBackLink onClick={() => goto(backHref)} />
		{/if}
	{/snippet}
	{#snippet navRight()}
		{#if children}
			{@render children()}
		{/if}
	{/snippet}
	{#if titleSnippet}
		{#snippet navTitle()}
			{@render titleSnippet()}
		{/snippet}
		<Navbar title={navTitle} subtitle={subtitle} left={navLeft} right={navRight} />
	{:else}
		<Navbar title={title} subtitle={subtitle} left={navLeft} right={navRight} />
	{/if}
</div>
