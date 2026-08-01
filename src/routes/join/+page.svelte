<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { saveHub, getHub } from '$lib/db/localDb';
  import { loadHubs } from '$lib/stores/hubs';
  import { deriveHubId } from '$lib/domain/hubId';
  import type { Hub } from '$lib/domain/types';

  let error = $state('');

  onMount(async () => {
    const name = page.url.searchParams.get('name')?.trim() ?? '';
    const claimedId = page.url.searchParams.get('id')?.trim() ?? '';

    if (!name) {
      error = 'This link is missing a hub name.';
      return;
    }

    // The id in the link is a convenience, not an authority — recompute it so a
    // tampered link cannot point a known name at a different board.
    const hubId = await deriveHubId(name);
    if (claimedId && claimedId !== hubId) {
      error = 'This link looks altered — its id does not match its name.';
      return;
    }

    if (!(await getHub(hubId))) {
      const hub: Hub = {
        hubId,
        name,
        createdAt: Date.now(),
        isOwned: false
      };
      await saveHub(hub);
      await loadHubs();
    }

    goto(`/hub/${hubId}`, { replaceState: true });
  });
</script>

<div class="text-center animate-in" style="padding-top: 48px;">
  {#if error}
    <p class="text-sm text-accent mb-4">{error}</p>
    <button class="w-full" onclick={() => goto('/')}>go home</button>
  {:else}
    <p class="text-tertiary pulse">joining hub...</p>
  {/if}
</div>
