<!--
  @file LinkSourceBar.svelte
  @description Consistent source indicator: favicon + domain. Placed above titles in all link cards.
-->
<script lang="ts">
	import { faviconUrl } from '$lib/utils/ogParser';

	let {
		domain,
		favicon,
		mode = 'surface'
	}: {
		domain: string;
		favicon?: string | null;
		mode?: 'surface' | 'overlay';
	} = $props();

	let faviconError = $state(false);
	const resolvedFavicon = $derived(favicon ?? faviconUrl(domain));
</script>

<div class="flex items-center gap-1.5 {mode === 'overlay' ? 'mb-1.5' : 'mb-1.5'}">
	{#if !faviconError}
		<img src={resolvedFavicon} alt="" class="w-4 h-4 rounded-[4px] shrink-0 {mode === 'overlay' ? 'ring-1 ring-white/10' : 'ring-1 ring-border/20'}"
			onerror={() => (faviconError = true)} />
	{:else}
		<div class="w-4 h-4 rounded-[4px] shrink-0 flex items-center justify-center text-[8px] font-bold
			{mode === 'overlay' ? 'bg-white/15 text-white/60 ring-1 ring-white/10' : 'bg-surface text-muted/50 ring-1 ring-border/20'}">
			{domain.charAt(0).toUpperCase()}
		</div>
	{/if}
	<span class="text-[11px] font-medium truncate {mode === 'overlay' ? 'text-white/70' : 'text-muted/60'}">
		{domain}
	</span>
</div>
