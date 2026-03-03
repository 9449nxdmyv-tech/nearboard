<script lang="ts">
  import { onMount } from 'svelte';
  import { initInstallPrompt } from '$lib/pwa/installPrompt';
  import { getOrCreateIdentity } from '$lib/crypto/identity';
  import { pruneAllExpired } from '$lib/db/localDb';
  import { page } from '$app/state';
  import '../app.css';

  let { children } = $props();

  onMount(async () => {
    await getOrCreateIdentity();
    initInstallPrompt();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js');
    }
    const pruneInterval = setInterval(() => pruneAllExpired(), 30_000);
    return () => clearInterval(pruneInterval);
  });
</script>

<div class="container">
  {#key page.url.pathname}
    <div class="animate-in">
      {@render children()}
    </div>
  {/key}
</div>
